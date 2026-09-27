"""Source paging preserves complete raw views, exact values, and caller visibility."""

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
        date_column = "posted_date" if dataset == "settlement" else "activity_date"
        numeric_columns = ["amount", "quantity", "source_line_number"]
        if dataset == "data_kiosk":
            numeric_columns.append("fee_base")
        predicates: list[sql.Composable] = [
            sql.SQL("amount <> 0" if dataset == "data_kiosk" else "true")
        ]
        parameters: list[object] = []
        for name, comparison in (("p_date_from", ">="), ("p_date_to", "<=")):
            if options.get(name) is not None:
                predicates.append(
                    sql.SQL("{} {} %s::date").format(
                        sql.Identifier(date_column), sql.SQL(cast(LiteralString, comparison))
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
            "with matching as not materialized (select * from public.{view} where {predicates}), "
            "page as (select * from matching order by {ordering} limit %s offset %s) "
            "select jsonb_build_object('rows', coalesce((select jsonb_agg("
            "(to_jsonb(p) - {excluded}) || jsonb_build_object({numeric_strings}) "
            "order by {ordering}) from page p), '[]'::jsonb), "
            "'total_count', case when %s then (select count(*)::text from matching) end)"
        ).format(
            view=sql.Identifier(dataset + "_preprocess_entries"),
            predicates=sql.SQL(" and ").join(predicates),
            ordering=ordering,
            excluded=sql.Literal(
                "source_fields" if dataset == "settlement" else "native_dimensions"
            ),
            numeric_strings=sql.SQL(", ").join(
                sql.SQL("{}, p.{}::text").format(sql.Literal(column), sql.Identifier(column))
                for column in numeric_columns
            ),
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
        self.assertEqual(set(actual), {"rows", "total_count"})
        for row in cast(list[dict[str, object]], actual["rows"]):
            for column in ("amount", "quantity", "source_line_number", "fee_base"):
                value = row.get(column)
                self.assertTrue(value is None or isinstance(value, str), column)
        return actual

    def test_all_roles_orders_pages_and_exact_count_modes_match_raw_views(self) -> None:
        company_a, company_b = self.financial_fixture()
        users = (self.operator(), self.member(company_a), self.member(company_b), self.auth_user())
        for user, dataset, order, direction, offset, include_count in product(
            users,
            ("settlement", "data_kiosk"),
            ("date", "amount"),
            ("asc", "desc"),
            (0, 3, 100, 9007199254740991),
            (True, False),
        ):
            with self.subTest(dataset=dataset, order=order, direction=direction, offset=offset):
                self.assert_matches_view(
                    user,
                    dataset,
                    p_limit=3,
                    p_offset=offset,
                    p_order_by=order,
                    p_direction=direction,
                    p_include_count=include_count,
                )

    def test_source_filters_apply_before_the_limit_without_widening_access(self) -> None:
        company_a, company_b = self.financial_fixture()
        filters: tuple[dict[str, object], ...] = (
            {},
            {"p_date_from": "2026-06-16"},
            {"p_date_to": "2026-06-14"},
            {"p_date_from": "2026-06-15", "p_date_to": "2026-06-15"},
            {"p_skus": ["OTHER", "SKU"]},
            {"p_skus": ["OTHER"]},
            {"p_skus": ["unknown"]},
            {"p_marketplaces": ["Amazon.com", "Amazon.co.uk"]},
            {"p_marketplaces": ["Amazon.co.uk"]},
            {"p_types": ["PRODUCT_SALES", "FbaStorageFee"]},
            {"p_types": ["PRODUCT_REFUNDS"], "p_skus": ["SKU"]},
            {"p_skus": [], "p_types": None, "p_marketplaces": []},
        )
        for user, dataset, order, selection in product(
            (self.operator(), self.member(company_a), self.member(company_b)),
            ("settlement", "data_kiosk"),
            ("date", "amount"),
            filters,
        ):
            with self.subTest(dataset=dataset, selection=selection, order=order):
                self.assert_matches_view(user, dataset, p_order_by=order, p_limit=1, **selection)

    def test_operator_keeps_historical_and_account_rows_but_members_do_not(self) -> None:
        company, sku = self.owner()
        member, operator = self.member(company), self.operator()
        old_terms = self.fee(sku, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, old_settlement = self.settlement([self.transaction("999")], acquisition_id=acquisition)
        _, old_kiosk = self.kiosk(1, [self.component("999"), self.component("0")])
        account_settlement = self.transaction("1000", 4, category="SELBOX")
        account_settlement["sku"] = None
        account_kiosk = self.component("1000", category="SELBOX")
        account_kiosk["sku"] = None
        self.settlement(
            [self.transaction("10"), account_settlement],
            acquisition_id=acquisition,
            expected=old_settlement,
        )
        self.kiosk(
            2, [self.component("10"), self.component("0"), account_kiosk], expected=old_kiosk
        )
        for dataset in ("settlement", "data_kiosk"):
            operator_page = self.assert_matches_view(operator, dataset, p_order_by="amount")
            member_page = self.assert_matches_view(member, dataset, p_order_by="amount")
            self.assertEqual(operator_page["total_count"], "3")
            self.assertEqual(member_page["total_count"], "1")
            rows = cast(list[dict[str, object]], operator_page["rows"])
            self.assertEqual([row["amount"] for row in rows], ["1000", "999", "10"])
            self.assertEqual(rows[0]["category"], "SELBOX")
        self.assign("SKU", None, expected=old_terms)
        for dataset in ("settlement", "data_kiosk"):
            self.assertEqual(
                self.assert_matches_view(member, dataset), {"rows": [], "total_count": "0"}
            )

    def test_amount_order_uses_exact_signed_numeric_values_and_stable_ties(self) -> None:
        company, _ = self.owner()
        amounts = ["100.123456789012345678902", "100.123456789012345678901", "-10", "2", "2", "0"]
        transactions = [self.transaction(amount, line) for line, amount in enumerate(amounts, 3)]
        components = [self.component(amount) for amount in amounts]
        transactions[0]["quantity"] = 9007199254740993
        components[0]["quantity"] = "0.123456789012345678901"
        components[0]["fee_base"] = "100.123456789012345678902"
        self.settlement(transactions)
        self.kiosk(1, components)
        for user, dataset, direction in product(
            (self.operator(), self.member(company)),
            ("settlement", "data_kiosk"),
            ("asc", "desc"),
        ):
            rows: list[object] = []
            for offset in range(0, 7, 2):
                rows.extend(
                    cast(
                        list[object],
                        self.assert_matches_view(
                            user,
                            dataset,
                            p_order_by="amount",
                            p_direction=direction,
                            p_limit=2,
                            p_offset=offset,
                        )["rows"],
                    )
                )
            self.assertEqual(
                rows,
                self.expected(user, dataset, p_order_by="amount", p_direction=direction)["rows"],
            )

    def test_invoker_signature_and_execution_grants(self) -> None:
        assert_rpc_contract(self, "source_transaction_page", _PARAMETER_TYPES)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.source_transaction_page('settlement')")

    def test_invalid_requests_are_rejected(self) -> None:
        operator = self.operator()
        for dataset in (None, "live", "settlement; select 1", ""):
            with (
                self.subTest(dataset=dataset),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
            ):
                self.page(operator, dataset)
        invalid: tuple[dict[str, object], ...] = (
            {"p_limit": None},
            {"p_limit": 0},
            {"p_limit": 1001},
            {"p_offset": None},
            {"p_offset": -1},
            {"p_offset": 9007199254740992},
            {"p_order_by": None},
            {"p_order_by": "company_amount"},
            {"p_direction": None},
            {"p_direction": "desc; select 1"},
            {"p_include_count": None},
            {"p_date_from": "infinity"},
            {"p_date_from": "2026-06-16", "p_date_to": "2026-06-15"},
            {"p_skus": [None]},
            {"p_types": [["PRODUCT_SALES"]]},
            {"p_marketplaces": [None]},
        )
        for options in invalid:
            with (
                self.subTest(options=options),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
            ):
                self.page(operator, "settlement", **options)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.page(operator, "data_kiosk", p_marketplaces=["Unknown marketplace"])
