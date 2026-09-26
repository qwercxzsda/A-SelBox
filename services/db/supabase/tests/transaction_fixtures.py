"""Shared current transaction page fixture and independent full-view oracle."""

from typing import LiteralString, cast

from psycopg import sql

from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.search_fixtures import LIVE_SEARCH_COLUMNS, append_literal_search

_NUMERIC_COLUMNS = (
    "source_amount",
    "quantity",
    "fee_base",
    "fee_rate_percent",
    "fee_amount",
    "company_amount",
)
_ROW_COLUMNS = {
    "source",
    "source_row_id",
    "source_version_id",
    "preprocess_version",
    "source_identity_id",
    "seller_namespace",
    "marketplace_name",
    "activity_date",
    "sku",
    "component_type",
    "currency",
    "source_amount",
    "quantity",
    "fee_base",
    "category",
    "seller_sku_id",
    "terms_version_id",
    "company_id",
    "fee_period_id",
    "fee_rate_percent",
    "resolution_status",
    "fee_amount",
    "company_amount",
}
TRANSACTION_ARRAY_FILTERS: dict[str, tuple[str, LiteralString]] = {
    "p_company_ids": ("company_id", "uuid"),
    "p_skus": ("sku", "text"),
    "p_marketplaces": ("marketplace_name", "text"),
    "p_sources": ("source", "text"),
    "p_types": ("component_type", "text"),
}
TRANSACTION_PARAMETER_TYPES = {
    "p_limit": "integer",
    "p_offset": "bigint",
    "p_direction": "text",
    "p_date_from": "date",
    "p_date_to": "date",
    **{name: type_name + "[]" for name, (_, type_name) in TRANSACTION_ARRAY_FILTERS.items()},
    "p_include_count": "boolean",
    "p_fee_applicable": "boolean",
    "p_order_by": "text",
    "p_search": "text",
}


class TransactionPageFixture(FinancialFixture):
    def page(self, user: str, **options: object) -> dict[str, object]:
        arguments = sql.SQL(", ").join(
            sql.SQL("{} => %s::{}").format(
                sql.Identifier(name),
                sql.SQL(cast(LiteralString, TRANSACTION_PARAMETER_TYPES[name])),
            )
            for name in options
        )
        query = sql.SQL("select public.transaction_page({})").format(arguments)
        result = self.as_user(
            user, cast(LiteralString, query.as_string(self.connection)), tuple(options.values())
        )
        return cast(dict[str, object], result[0][0])

    def expected(self, user: str, **options: object) -> dict[str, object]:
        predicates: list[sql.Composable] = [
            sql.SQL("(source <> 'DATA_KIOSK' or source_amount <> 0)")
        ]
        parameters: list[object] = []
        for name, comparison in (("p_date_from", ">="), ("p_date_to", "<=")):
            if options.get(name) is not None:
                predicates.append(
                    sql.SQL("activity_date {} %s::date").format(
                        sql.SQL(cast(LiteralString, comparison))
                    )
                )
                parameters.append(options[name])
        for name, (column, type_name) in TRANSACTION_ARRAY_FILTERS.items():
            if options.get(name):
                predicates.append(
                    sql.SQL("{}::{} = any(%s::{}[])").format(
                        sql.Identifier(column), sql.SQL(type_name), sql.SQL(type_name)
                    )
                )
                parameters.append(options[name])
        if options.get("p_fee_applicable") is not None:
            # Canonical preprocessing keeps TYPE and fee-base presence equivalent.
            # Keep this independent financial oracle for the ordinary fixtures.
            predicates.append(sql.SQL("(fee_base is not null) = %s::boolean"))
            parameters.append(options["p_fee_applicable"])
        append_literal_search(predicates, parameters, LIVE_SEARCH_COLUMNS, options.get("p_search"))
        date_order = options.get("p_order_by", "date") == "date"
        direction = cast(LiteralString, options.get("p_direction", "desc"))
        ties = direction if date_order else "asc"
        nulls = "first" if date_order and direction == "desc" else "last"
        ordering = sql.SQL("{} {} nulls {}, source {}, source_row_id {}").format(
            sql.Identifier(
                "source_amount" if options.get("p_order_by") == "amount" else "activity_date"
            ),
            sql.SQL(direction),
            sql.SQL(nulls),
            sql.SQL(ties),
            sql.SQL(ties),
        )
        numeric_strings = sql.SQL(", ").join(
            sql.SQL("{}, p.{}::text").format(sql.Literal(column), sql.Identifier(column))
            for column in _NUMERIC_COLUMNS
        )
        query = sql.SQL(
            "with matching as not materialized ("
            " select * from public.live_company_components where {predicates}"
            "), page as (select * from matching order by {ordering} limit %s offset %s) "
            "select jsonb_build_object("
            " 'rows', coalesce((select jsonb_agg("
            "   (to_jsonb(p) - 'authoritative') || jsonb_build_object({numeric_strings})"
            "   order by {ordering}) from page p), '[]'::jsonb),"
            " 'total_count', case when %s then (select count(*)::text from matching) end)"
        ).format(
            predicates=sql.SQL(" and ").join(predicates),
            ordering=ordering,
            numeric_strings=numeric_strings,
        )
        parameters.extend(
            (
                options.get("p_limit", 25),
                options.get("p_offset", 0),
                options.get("p_include_count", True),
            )
        )
        result = self.as_user(
            user, cast(LiteralString, query.as_string(self.connection)), parameters
        )
        return cast(dict[str, object], result[0][0])

    def assert_matches_view(self, user: str, **options: object) -> dict[str, object]:
        actual = self.page(user, **options)
        self.assertEqual(actual, self.expected(user, **options))
        self.assertEqual(set(actual), {"rows", "total_count"})
        for row in cast(list[dict[str, object]], actual["rows"]):
            self.assertEqual(set(row), _ROW_COLUMNS)
            for column in _NUMERIC_COLUMNS:
                self.assertTrue(row[column] is None or isinstance(row[column], str), column)
        return actual
