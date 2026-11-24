"""Bounded summaries preserve filtered transaction sums and authorization."""

from itertools import combinations, product
from typing import cast

import psycopg
from psycopg import sql

from services.db.supabase.tests.rpc_support import assert_rpc_security, read_rpc_execution_settings
from services.db.supabase.tests.search_fixtures import LIVE_SEARCH_FIELDS
from services.db.supabase.tests.transaction_totals_fixture import (
    TRANSACTION_TOTALS_PARAMETER_TYPES,
    TransactionTotalsFixture,
)


class TransactionTotalsTests(TransactionTotalsFixture):
    def test_planner_preferences_are_function_local_and_memory_limits_are_inherited(self) -> None:
        company, _ = self.owner()
        self.finances([self.transaction("100")])
        member = self.member(company)
        before = read_rpc_execution_settings(self.connection)
        self.assert_matches_view(member, p_granularity="day")
        self.assertEqual(read_rpc_execution_settings(self.connection), before)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.read_totals(member, p_granularity="invalid")
        self.assertEqual(read_rpc_execution_settings(self.connection), before)
        config = self.connection.execute(
            "select proconfig from pg_proc where pronamespace='public'::regnamespace "
            "and proname='transaction_totals'"
        ).fetchone()
        self.assertIsNotNone(config)
        self.assertEqual(
            set(config[0] if config else []),
            {
                'search_path=""',
                "plan_cache_mode=force_custom_plan",
                "enable_sort=off",
                "enable_presorted_aggregate=off",
            },
        )

    def test_roles_exact_money_and_missing_states_match_view(self) -> None:
        first, second = self.financial_fixture()
        for user, grouped in product(
            (None, self.administrator(), self.member(first), self.member(second), self.auth_user()),
            (False, True),
        ):
            with self.subTest(user=user, grouped=grouped):
                self.assert_matches_view(user, p_group_by_type=grouped)
        administrator = self.administrator()
        for sku in ("GAP", "UNKNOWN", "UNASSIGNED"):
            result = self.assert_matches_view(administrator, p_skus=[sku])
            rows = cast(list[dict[str, object]], result["rows"])
            self.assertEqual(bool(rows), sku == "GAP")
            self.assertTrue(all(row["company_amount"] is None for row in rows))
            self.assertTrue(all(row["known_company_count"] == "0" for row in rows))

    def test_selection_combinations_and_open_date_bounds_match_view(self) -> None:
        first, _ = self.financial_fixture()
        filters: dict[str, object] = {
            "p_date_from": "2026-06-15",
            "p_date_to": "2026-06-16",
            "p_company_ids": [first],
            "p_skus": ["SKU"],
            "p_marketplaces": ["Amazon.com"],
            "p_currency": "USD",
        }
        for size in range(len(filters) + 1):
            for names in combinations(filters, size):
                options = {name: filters[name] for name in names}
                for user in (self.administrator(), self.member(first)):
                    self.assert_matches_view(user, p_group_by_type=True, **options)
        self.assert_matches_view(self.member(first), p_date_from=None, p_date_to="2026-06-16")

    def test_type_source_fee_and_search_filters_apply_before_both_aggregations(self) -> None:
        first, _ = self.financial_fixture()
        filters: tuple[dict[str, object], ...] = (
            {"p_sources": ["FINANCES"]},
            {"p_sources": ["AD_INVOICE"]},
            {"p_types": ["PRODUCT_SALES", "FbaStorageFee"]},
            {"p_fee_applicable": True},
            {"p_fee_applicable": False},
            {"p_search_skus": ["SKU"]},
            {"p_search_types": ["FbaStorageFee"]},
            {"p_search_marketplaces": ["Amazon.com"]},
            {"p_search_sources": ["AD_INVOICE"]},
            {name: [] for name in LIVE_SEARCH_FIELDS},
            {"p_search_skus": ["OTHER"], "p_search_types": ["PRODUCT_SALES"]},
        )
        for user, grouped in product((self.administrator(), self.member(first)), (False, True)):
            for left, right in combinations(({}, *filters), 2):
                with self.subTest(grouped=grouped, filters=(left, right)):
                    self.assert_matches_view(user, p_group_by_type=grouped, **(left | right))
            result = self.assert_matches_view(
                user,
                p_group_by_type=grouped,
                p_date_from="2026-06-15",
                p_date_to="2026-06-16",
                p_company_ids=[first],
                p_skus=["SKU"],
                p_marketplaces=["Amazon.com"],
                p_currency="USD",
                p_sources=["FINANCES"],
                p_types=["PRODUCT_SALES"],
                p_fee_applicable=True,
                p_search_skus=["SKU"],
                p_search_types=[],
                p_search_marketplaces=[],
                p_search_sources=[],
            )
            self.assertTrue(result["rows"])

    def test_empty_unknown_and_other_company_filters_do_not_expand_scope(self) -> None:
        first, second = self.financial_fixture()
        member, administrator = self.member(first), self.administrator()
        empty_selections: tuple[object, ...] = (None, [])
        for user in (member, administrator):
            for empty in empty_selections:
                self.assert_matches_view(
                    user, p_company_ids=empty, p_skus=empty, p_marketplaces=empty
                )
            for filters in (
                {"p_skus": ["absent"]},
                {"p_currency": "EUR"},
                {"p_marketplaces": ["Amazon.co.uk"]},
                {"p_date_from": "2027-01-01"},
            ):
                self.assertEqual(
                    self.assert_matches_view(user, **filters), {"rows": [], "group_count": "0"}
                )
            self.assert_matches_view(
                user, p_skus=["SKU", "GAP", "SKU"], p_company_ids=[first, second, first]
            )
        self.assertEqual(self.read_totals(member, p_company_ids=[second])["rows"], [])

    def test_marketplace_currency_groups_remain_separate_and_ordered(self) -> None:
        company, _ = self.owner()
        self.finances(
            [
                self.transaction("10.25", 3, description="Shipping"),
                self.transaction("20.75", 4, description="Shipping")
                | {"marketplace_name": "Amazon.ca"},
                self.transaction("3.50", 5, description="Shipping") | {"currency": "EUR"},
            ]
        )
        for user in (self.administrator(), self.member(company)):
            result = self.assert_matches_view(user)
            rows = cast(list[dict[str, object]], result["rows"])
            self.assertEqual(
                [
                    (row["marketplace_name"], row["currency"], row["reported_amount"])
                    for row in rows
                ],
                [
                    ("Amazon.ca", "USD", "20.75"),
                    ("Amazon.com", "EUR", "3.50"),
                    ("Amazon.com", "USD", "10.25"),
                ],
            )
            self.assertEqual(result["group_count"], "3")
            grouped = self.assert_matches_view(user, p_group_by_type=True, p_currency="USD")
            types = cast(list[dict[str, object]], grouped["rows"])
            self.assertEqual(len(types), 1)
            self.assertIsNone(types[0]["marketplace_name"])
            self.assertEqual(types[0]["reported_amount"], "31.00")
            self.assert_matches_view(
                user, p_group_by_type=True, p_currency="USD", p_marketplaces=["Amazon.com"]
            )

    def test_more_than_one_thousand_unicode_groups_return_completely_in_order(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        types = [f"TYPE-{number:04}" for number in range(1000)] + ["Ä", "ä", "가", "😀"]
        self.finances(
            [
                self.transaction("1", i + 3)
                | {"component_type": kind, "fee_base": None, "quantity": None}
                for i, kind in enumerate(types)
            ]
        )
        member = self.member(company)
        result = self.assert_matches_view(member, p_group_by_type=True)
        self.assertEqual(result["group_count"], "1004")
        rows = cast(list[dict[str, object]], result["rows"])
        self.assertEqual(
            [row["component_type"] for row in rows], sorted(types, key=lambda value: value.encode())
        )

    def test_invalid_input_shapes_are_rejected_and_unknown_marketplaces_match_nothing(self) -> None:
        user = self.administrator()
        invalid: tuple[dict[str, object], ...] = (
            {"p_date_from": None},
            {"p_date_from": "infinity"},
            {"p_date_to": "-infinity"},
            {"p_date_to": "2025-12-31"},
            {"p_group_by_type": None},
            {"p_granularity": "month"},
            {"p_granularity": ""},
            {"p_granularity": "DAY"},
            {"p_currency": "usd"},
            {"p_currency": ""},
            {"p_currency": "USD') OR true --"},
        )
        for options in invalid:
            with (
                self.subTest(options=options),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
            ):
                self.read_totals(user, **options)
        company, _ = self.owner()
        for name, value in (
            ("p_company_ids", company),
            ("p_skus", "SKU"),
            ("p_marketplaces", "Amazon.com"),
            ("p_sources", "FINANCES"),
            ("p_types", "PRODUCT_SALES"),
            *((name, "value") for name in LIVE_SEARCH_FIELDS),
        ):
            for values in ([None], [value, None], [[value]]):
                with self.assertRaises(psycopg.errors.InvalidParameterValue):
                    self.read_totals(user, **{name: values})
        self.assertEqual(
            self.read_totals(user, p_marketplaces=["unknown"]),
            {"rows": [], "group_count": "0"},
        )

    def test_security_invoker_grants_and_anonymous_denial(self) -> None:
        assert_rpc_security(
            self,
            "public.transaction_totals("
            + ",".join(TRANSACTION_TOTALS_PARAMETER_TYPES.values())
            + ")",
        )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.transaction_totals(p_date_from => '2026-01-01')")
        self.assertEqual(
            self.connection.execute(
                "select count(*) from pg_proc where pronamespace='public'::regnamespace "
                "and proname='transaction_totals'"
            ).fetchone(),
            (1,),
        )
        for paging_argument in ("p_limit", "p_offset"):
            with self.assertRaises(psycopg.errors.UndefinedFunction), self.connection.transaction():
                self.connection.execute(
                    sql.SQL(
                        "select public.transaction_totals(p_date_from=>'2026-01-01', {}=>1)"
                    ).format(sql.Identifier(paging_argument))
                )
