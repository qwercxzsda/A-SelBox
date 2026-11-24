"""Source paging preserves normalized views, exact values, and caller visibility."""

from itertools import product
from typing import LiteralString, cast

import psycopg
from psycopg import sql

from services.db.supabase.tests import test_transaction_page as live_fixture
from services.db.supabase.tests.rpc_support import assert_rpc_contract
from services.db.supabase.tests.search_fixtures import (
    SOURCE_SEARCH_FIELDS,
    append_search_selections,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture

_PARAMETER_TYPES = {
    "p_dataset": "text",
    "p_limit": "integer",
    "p_offset": "bigint",
    "p_order_by": "text",
    "p_direction": "text",
    "p_date_from": "date",
    "p_date_to": "date",
    "p_skus": "text[]",
    "p_marketplaces": "text[]",
    "p_types": "text[]",
    "p_include_count": "boolean",
    **dict.fromkeys(SOURCE_SEARCH_FIELDS, "text[]"),
}
_ARRAY_FILTERS: dict[str, tuple[str, LiteralString]] = {
    "p_skus": ("sku", "text"),
    "p_marketplaces": ("marketplace_name", "text"),
    "p_types": ("component_type", "text"),
}


class SourceTransactionPageTests(SourceModelFixture):
    assign = live_fixture.TransactionPageTests.assign
    financial_fixture = live_fixture.TransactionPageTests.financial_fixture

    def page(self, user: str, dataset: object, **options: object) -> dict[str, object]:
        options = {"p_dataset": dataset, **options}
        arguments = sql.SQL(", ").join(
            sql.SQL("{} => %s::{}").format(
                sql.Identifier(name), sql.SQL(cast(LiteralString, _PARAMETER_TYPES[name]))
            )
            for name in options
        )
        query = sql.SQL("select public.source_transaction_page({})").format(arguments)
        return cast(
            dict[str, object],
            self.as_user(
                user, cast(LiteralString, query.as_string(self.connection)), tuple(options.values())
            )[0][0],
        )

    def expected(self, user: str, dataset: str, **options: object) -> dict[str, object]:
        date_column = "activity_at"
        timestamp_projection = ", e.posted_at as activity_at" if dataset == "finances" else ""
        predicates: list[sql.Composable] = [sql.SQL("true")]
        parameters: list[object] = []
        for name, comparison in (("p_date_from", ">="), ("p_date_to", "<=")):
            if options.get(name) is not None:
                predicates.append(
                    sql.SQL("{} {} %s::date").format(
                        sql.SQL("(activity_at at time zone 'UTC')::date"),
                        sql.SQL(cast(LiteralString, comparison)),
                    )
                )
                parameters.append(options[name])
        for name, (column, type_name) in _ARRAY_FILTERS.items():
            if options.get(name):
                predicates.append(
                    sql.SQL("{} = any(%s::{}[])").format(sql.Identifier(column), sql.SQL(type_name))
                )
                parameters.append(options[name])
        append_search_selections(predicates, parameters, SOURCE_SEARCH_FIELDS, options)
        date_order = options.get("p_order_by", "date") == "date"
        direction = cast(LiteralString, options.get("p_direction", "desc"))
        ties = direction if date_order else "asc"
        nulls = "first" if date_order and direction == "desc" else "last"
        ordering = sql.SQL("{} {} nulls {}, id {}").format(
            sql.Identifier("amount" if options.get("p_order_by") == "amount" else date_column),
            sql.SQL(direction),
            sql.SQL(nulls),
            sql.SQL(ties),
        )
        query = sql.SQL(
            "with source_rows as (select e.* {timestamp_projection} from public.{view} e), "
            "matching as not materialized (select * from source_rows where {predicates}), "
            "page as (select * from matching order by {ordering} limit %s offset %s) "
            "select jsonb_build_object('rows', coalesce((select jsonb_agg("
            "(select jsonb_object_agg(key,value) from jsonb_each_text(to_jsonb(p))) "
            "|| jsonb_build_object('activity_at', to_char(p.activity_at at time zone 'UTC', "
            '\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\')) '
            "order by {ordering}) from page p), '[]'::jsonb), "
            "'total_count', case when %s then (select count(*)::text from matching) end)"
        ).format(
            view=sql.Identifier(dataset + "_preprocess_entries"),
            timestamp_projection=sql.SQL(cast(LiteralString, timestamp_projection)),
            predicates=sql.SQL(" and ").join(predicates),
            ordering=ordering,
        )
        parameters.extend(
            (
                options.get("p_limit", 25),
                options.get("p_offset", 0),
                options.get("p_include_count", True),
            )
        )
        return cast(
            dict[str, object],
            self.as_user(user, cast(LiteralString, query.as_string(self.connection)), parameters)[
                0
            ][0],
        )

    def assert_matches_view(self, user: str, dataset: str, **options: object) -> dict[str, object]:
        actual = self.page(user, dataset, **options)
        self.assertEqual(actual, self.expected(user, dataset, **options))
        for row in cast(list[dict[str, object]], actual["rows"]):
            self.assertTrue(
                all(
                    row[field] is None or isinstance(row[field], str)
                    for field in ("amount", "quantity", "fee_base")
                )
            )
            self.assertIn("batch_id", row)
            self.assertIn("is_current", row)
        return actual

    def test_finances_pages_keep_exact_counts_across_orders(self) -> None:
        self.financial_fixture()
        actor = self.administrator()
        for order, direction, include_count in product(
            ("date", "amount"), ("asc", "desc"), (True, False)
        ):
            self.assert_matches_view(
                actor,
                "finances",
                p_order_by=order,
                p_direction=direction,
                p_include_count=include_count,
                p_limit=2,
                p_offset=2,
            )

    def test_invoker_signature_and_execution_grants(self) -> None:
        assert_rpc_contract(self, "source_transaction_page", _PARAMETER_TYPES)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.source_transaction_page('finances')")
