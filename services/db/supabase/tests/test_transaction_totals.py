"""Bounded summaries preserve contributing company-financial sums and authorization."""

from itertools import combinations, product
from typing import LiteralString, cast

import psycopg
from psycopg import sql

from services.db.supabase.tests import test_live_view_equivalence as live_fixture
from services.db.supabase.tests.rpc_support import assert_rpc_security
from services.db.supabase.tests.source_fixtures import SourceModelFixture

_PARAMETER_TYPES = {
    "p_date_from": "date",
    "p_date_to": "date",
    "p_company_ids": "uuid[]",
    "p_skus": "text[]",
    "p_marketplaces": "text[]",
    "p_currency": "text",
    "p_group_by_type": "boolean",
    "p_limit": "integer",
    "p_offset": "bigint",
}
_NUMERIC_FIELDS = (
    "reported_amount",
    "service_fee",
    "company_amount",
    "row_count",
    "known_company_count",
)


class TransactionTotalsTests(SourceModelFixture):
    assign = live_fixture.LiveViewEquivalenceTests.assign
    financial_fixture = live_fixture.LiveViewEquivalenceTests.financial_fixture

    def read_totals(self, user: str | None, **options: object) -> dict[str, object]:
        options = {"p_date_from": "2026-01-01", **options}
        arguments = sql.SQL(", ").join(
            sql.SQL("{} => %s::{}").format(
                sql.Identifier(name), sql.SQL(cast(LiteralString, _PARAMETER_TYPES[name]))
            )
            for name in options
        )
        query = sql.SQL("select public.transaction_totals({})").format(arguments)
        result = (
            self.connection.execute(query, tuple(options.values())).fetchall()
            if user is None
            else self.as_user(
                user, cast(LiteralString, query.as_string(self.connection)), tuple(options.values())
            )
        )
        return cast(dict[str, object], result[0][0])

    def expected(self, user: str | None, **options: object) -> dict[str, object]:
        options = {"p_date_from": "2026-01-01", **options}
        predicates: list[sql.Composable] = [
            sql.SQL("authoritative and category in ('FINANCES', 'DATA_KIOSK')")
        ]
        parameters: list[object] = []
        for name, column, comparison, type_name in (
            ("p_date_from", "utc_date", ">=", "date"),
            ("p_date_to", "utc_date", "<=", "date"),
            ("p_currency", "currency", "=", "text"),
        ):
            if options.get(name) is not None:
                predicates.append(
                    sql.SQL("{} {} %s::{}").format(
                        sql.Identifier(column),
                        sql.SQL(cast(LiteralString, comparison)),
                        sql.SQL(cast(LiteralString, type_name)),
                    )
                )
                parameters.append(options[name])
        for name, column, type_name in (
            ("p_company_ids", "company_id", "uuid[]"),
            ("p_skus", "sku", "text[]"),
            ("p_marketplaces", "marketplace_name", "text[]"),
        ):
            if options.get(name):
                predicates.append(
                    sql.SQL("{} = any(%s::{})").format(
                        sql.Identifier(column), sql.SQL(cast(LiteralString, type_name))
                    )
                )
                parameters.append(options[name])
        query = sql.SQL("""
            with source_rows as (
                select c.*, (case when c.source='FINANCES' then f.posted_at
                    else k.activity_at
                    end at time zone 'UTC')::date as utc_date
                from public.live_company_components c
                left join private.finances_transaction_versions f
                    on c.source='FINANCES' and f.id=c.source_version_id
                left join private.data_kiosk_day_versions k
                    on c.source='DATA_KIOSK' and k.id=c.source_version_id
            ), totals as (select
                case when not %s::boolean then marketplace_name end as marketplace_name,
                currency,
                case when %s::boolean then component_type end as component_type,
                sum(source_amount)::text as reported_amount,
                sum(fee_amount)::text as service_fee,
                sum(company_amount)::text as company_amount,
                count(*)::text as row_count,
                count(company_amount)::text as known_company_count
            from source_rows where {predicates}
            group by 1,2,3) select * from totals
            order by marketplace_name collate "C" nulls first,
                currency collate "C", component_type collate "C" nulls first
        """).format(predicates=sql.SQL(" and ").join(predicates))
        parameters.insert(0, options.get("p_group_by_type", False))
        parameters.insert(0, options.get("p_group_by_type", False))
        result = (
            self.connection.execute(query, parameters).fetchall()
            if user is None
            else self.as_user(
                user, cast(LiteralString, query.as_string(self.connection)), parameters
            )
        )
        keys = ("marketplace_name", "currency", "component_type", *_NUMERIC_FIELDS)
        rows = [dict(zip(keys, row, strict=True)) for row in result]
        offset, limit = (
            cast(int, options.get("p_offset", 0)),
            cast(int, options.get("p_limit", 1000)),
        )
        return {
            "rows": rows[offset : offset + limit],
            "next_offset": offset + limit if len(rows) > offset + limit else None,
        }

    def assert_matches_view(self, user: str | None, **options: object) -> dict[str, object]:
        actual = self.read_totals(user, **options)
        self.assertEqual(actual, self.expected(user, **options))
        self.assertEqual(set(actual), {"rows", "next_offset"})
        for row in cast(list[dict[str, object]], actual["rows"]):
            self.assertEqual(
                set(row), {"marketplace_name", "currency", "component_type", *_NUMERIC_FIELDS}
            )
            for key in _NUMERIC_FIELDS:
                self.assertTrue(row[key] is None or isinstance(row[key], str))
            self.assertIsNotNone(row["row_count"])
            self.assertIsNotNone(row["known_company_count"])
        return actual

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
            self.assertTrue(rows)
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
                    self.assert_matches_view(user, **filters), {"rows": [], "next_offset": None}
                )
            self.assert_matches_view(
                user, p_skus=["SKU", "GAP", "SKU"], p_company_ids=[first, second, first]
            )
        self.assertEqual(self.read_totals(member, p_company_ids=[second])["rows"], [])

    def test_preaggregation_keeps_applicable_zero_separate_from_missing_fee(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.assign("GAP", company)
        self.finances(
            [
                self.transaction("0", 3),
                self.transaction("10", 4),
                self.transaction("-10", 5),
                self.transaction("0", 6, sku="GAP"),
                self.transaction("3", 7, sku="GAP", description="Shipping"),
            ]
        )
        self.kiosk(
            1, [self.component("4", sku="GAP"), self.component("5", sku="GAP") | {"fee_base": "0"}]
        )
        result = self.assert_matches_view(self.member(company), p_skus=["GAP"])
        row = cast(list[dict[str, object]], result["rows"])[0]
        self.assertEqual(row["row_count"], "4")
        self.assertEqual(row["known_company_count"], "2")
        self.assertEqual(row["company_amount"], "7")
        self.assert_matches_view(self.member(company), p_group_by_type=True)

    def test_marketplace_currency_groups_remain_separate_and_page_in_order(self) -> None:
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
            for offset, row in enumerate(rows):
                page = self.assert_matches_view(user, p_limit=1, p_offset=offset)
                self.assertEqual(page["rows"], [row])
                self.assertEqual(page["next_offset"], offset + 1 if offset < 2 else None)
            grouped = self.assert_matches_view(user, p_group_by_type=True, p_currency="USD")
            types = cast(list[dict[str, object]], grouped["rows"])
            self.assertEqual(len(types), 1)
            self.assertIsNone(types[0]["marketplace_name"])
            self.assertEqual(types[0]["reported_amount"], "31.00")
            self.assert_matches_view(
                user, p_group_by_type=True, p_currency="USD", p_marketplaces=["Amazon.com"]
            )

    def test_reprocessing_and_ownership_changes_are_current(self) -> None:
        first, sku = self.owner()
        second, _ = self.owner("OTHER")
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, _version = self.finances([self.transaction("10")], acquisition_id=acquisition)
        _, kiosk = self.kiosk(1, [self.component("3")])
        users = (self.administrator(), self.member(first), self.member(second))
        for user in users:
            self.assert_matches_view(user)
        self.finances([self.transaction("20")], acquisition_id=acquisition)
        self.kiosk(2, [], expected=kiosk)
        terms = self.assign("SKU", second, rate="7", expected=terms)
        for user in users:
            self.assert_matches_view(user)
        self.assign("SKU", None, expected=terms)
        for user in users:
            self.assert_matches_view(user)

    def test_more_than_one_thousand_unicode_groups_page_without_extra_count(self) -> None:
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
        first = self.assert_matches_view(member, p_group_by_type=True)
        self.assertEqual(first["next_offset"], 1000)
        second = self.assert_matches_view(member, p_group_by_type=True, p_offset=1000)
        self.assertIsNone(second["next_offset"])
        rows = cast(list[dict[str, object]], first["rows"]) + cast(
            list[dict[str, object]], second["rows"]
        )
        self.assertEqual(
            [row["component_type"] for row in rows], sorted(types, key=lambda value: value.encode())
        )
        self.assert_matches_view(member, p_group_by_type=True, p_limit=1, p_offset=9007199254740991)
        self.assert_matches_view(member, p_group_by_type=True, p_limit=2, p_offset=1)

    def test_invalid_input_shapes_are_rejected_and_unknown_marketplaces_match_nothing(self) -> None:
        user = self.administrator()
        invalid: tuple[dict[str, object], ...] = (
            {"p_date_from": None},
            {"p_date_from": "infinity"},
            {"p_date_to": "-infinity"},
            {"p_date_to": "2025-12-31"},
            {"p_limit": None},
            {"p_limit": 0},
            {"p_limit": 1001},
            {"p_offset": None},
            {"p_offset": -1},
            {"p_offset": 9007199254740992},
            {"p_group_by_type": None},
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
        ):
            for values in ([None], [value, None], [[value]]):
                with self.assertRaises(psycopg.errors.InvalidParameterValue):
                    self.read_totals(user, **{name: values})
        self.assertEqual(
            self.read_totals(user, p_marketplaces=["unknown"]),
            {"rows": [], "next_offset": None},
        )

    def test_security_invoker_grants_and_anonymous_denial(self) -> None:
        assert_rpc_security(
            self, "public.transaction_totals(" + ",".join(_PARAMETER_TYPES.values()) + ")"
        )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.transaction_totals(p_date_from => '2026-01-01')")
