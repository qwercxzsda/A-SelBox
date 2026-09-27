"""The count-only RPC preserves exact filtered membership and caller visibility."""

from itertools import combinations
from typing import LiteralString, cast

import psycopg
from psycopg import sql

from services.db.supabase.tests import test_transaction_page as page_fixture
from services.db.supabase.tests.rpc_support import assert_rpc_contract
from services.db.supabase.tests.search_fixtures import LIVE_SEARCH_FIELDS
from services.db.supabase.tests.source_fixtures import SourceModelFixture

_ARRAY_FILTERS = ("p_company_ids", "p_skus", "p_marketplaces", "p_sources", "p_types")
_PARAMETER_TYPES = {
    "p_date_from": "date",
    "p_date_to": "date",
    **{name: "uuid[]" if name == "p_company_ids" else "text[]" for name in _ARRAY_FILTERS},
    "p_marketplaces": "text[]",
    "p_fee_applicable": "boolean",
    **dict.fromkeys(LIVE_SEARCH_FIELDS, "text[]"),
}


class TransactionCountTests(SourceModelFixture):
    assign = page_fixture.TransactionPageTests.assign
    financial_fixture = page_fixture.TransactionPageTests.financial_fixture
    expected_page = page_fixture.TransactionPageTests.expected
    page = page_fixture.TransactionPageTests.page

    def count(self, user: str, **options: object) -> str:
        arguments = sql.SQL(", ").join(
            sql.SQL("{} => %s::{}").format(
                sql.Identifier(name), sql.SQL(cast(LiteralString, _PARAMETER_TYPES[name]))
            )
            for name in options
        )
        query = sql.SQL("select public.transaction_count({})").format(arguments)
        result = self.as_user(
            user, cast(LiteralString, query.as_string(self.connection)), tuple(options.values())
        )
        count = result[0][0]
        self.assertIsInstance(count, str)
        self.assertTrue(cast(str, count).isdecimal())
        return cast(str, count)

    def assert_matches_view(self, user: str, **options: object) -> str:
        actual = self.count(user, **options)
        expected = self.expected_page(user, p_include_count=True, **options)["total_count"]
        self.assertEqual(actual, expected)
        return actual

    def test_roles_zero_visibility_and_missing_fee_rows_are_counted_exactly(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user, expected in (
            (self.operator(), "19"),
            (self.member(company_a), "9"),
            (self.member(company_b), "4"),
            (self.auth_user(), "0"),
        ):
            with self.subTest(user=user):
                self.assertEqual(self.assert_matches_view(user), expected)

    def test_all_filter_combinations_match_the_complete_live_view(self) -> None:
        company_a, _ = self.financial_fixture()
        filters: dict[str, object] = {
            "p_date_from": "2026-06-15",
            "p_date_to": "2026-06-16",
            "p_company_ids": [company_a],
            "p_skus": ["SKU"],
            "p_marketplaces": ["Amazon.com"],
            "p_sources": ["DATA_KIOSK"],
            "p_types": ["FbaStorageFee"],
            "p_fee_applicable": False,
        }
        users = (self.operator(), self.member(company_a))
        for size in range(len(filters) + 1):
            for names in combinations(filters, size):
                options = {name: filters[name] for name in names}
                for user in users:
                    with self.subTest(user=user, filters=names):
                        self.assert_matches_view(user, **options)

    def test_fee_applicability_counts_match_pages_and_partition_visible_facts(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user in (
            self.operator(),
            self.member(company_a),
            self.member(company_b),
            self.auth_user(),
        ):
            counts: list[int] = []
            for applicable in (True, False, None):
                count = self.assert_matches_view(user, p_fee_applicable=applicable)
                page = self.page(user, p_fee_applicable=applicable, p_include_count=True)
                self.assertEqual(page["total_count"], count)
                counts.append(int(count))
            self.assertEqual(counts[0] + counts[1], counts[2])

    def test_multiselect_empty_and_unknown_filters_preserve_company_scope(self) -> None:
        company_a, company_b = self.financial_fixture()
        member = self.member(company_a)
        empty_selections: tuple[object, ...] = (None, [])
        for user in (self.operator(), member):
            for empty in empty_selections:
                self.assert_matches_view(
                    user, p_date_from=None, p_date_to=None, **dict.fromkeys(_ARRAY_FILTERS, empty)
                )
            self.assert_matches_view(
                user,
                p_company_ids=[company_a, company_b, company_a],
                p_skus=["SKU", "OTHER", "GAP", "SKU"],
                p_marketplaces=["Amazon.com", "Amazon.co.uk"],
                p_sources=["DATA_KIOSK", "SETTLEMENT"],
                p_types=["FbaStorageFee", "PRODUCT_SALES", "PRODUCT_REFUNDS"],
            )
            self.assertEqual(self.assert_matches_view(user, p_skus=["not present"]), "0")
            self.assertEqual(
                self.assert_matches_view(user, p_sources=["SETTLEMENT'); select 1; --"]), "0"
            )
        self.assertEqual(self.assert_matches_view(member, p_company_ids=[company_b]), "0")

    def test_reprocessing_reassignment_and_unassignment_update_the_count(self) -> None:
        company_a, sku = self.owner()
        company_b, _ = self.owner("OTHER")
        member_a, member_b, operator = (
            self.member(company_a),
            self.member(company_b),
            self.operator(),
        )
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, settlement = self.settlement([self.transaction("100")], acquisition_id=acquisition)
        _, kiosk = self.kiosk(1, [self.component("-10")])
        for user, expected in ((operator, "2"), (member_a, "2"), (member_b, "0")):
            self.assertEqual(self.assert_matches_view(user), expected)
        self.settlement(
            [self.transaction("200", 3), self.transaction("300", 4)],
            acquisition_id=acquisition,
            expected=settlement,
        )
        self.kiosk(2, [self.component("0")], expected=kiosk)
        new_terms = self.assign("SKU", company_b, rate="7", expected=terms)
        for user, expected in ((operator, "2"), (member_a, "0"), (member_b, "2")):
            self.assertEqual(self.assert_matches_view(user), expected)
        self.assign("SKU", None, rate="7", expected=new_terms)
        for user, expected in ((operator, "2"), (member_a, "0"), (member_b, "0")):
            self.assertEqual(self.assert_matches_view(user), expected)

    def test_anonymous_execution_is_denied_and_function_keeps_invoker_security(self) -> None:
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.transaction_count()")
        assert_rpc_contract(self, "transaction_count", _PARAMETER_TYPES)

    def test_text_marketplace_counts_match_pages_for_all_roles(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user, total in (
            (self.operator(), "19"),
            (self.member(company_a), "9"),
            (self.member(company_b), "4"),
            (self.auth_user(), "0"),
        ):
            for selection in (
                None,
                [],
                ["Amazon.com"],
                ["Amazon.com", "Amazon.com"],
                ["Amazon.com", "Amazon.co.uk"],
                ["Amazon.co.uk"],
            ):
                with self.subTest(selection=selection):
                    count = self.assert_matches_view(user, p_marketplaces=selection)
                    page = self.page(
                        user, p_marketplaces=selection, p_include_count=True, p_limit=1000
                    )
                    self.assertEqual(count, "0" if selection == ["Amazon.co.uk"] else total)
                    self.assertEqual(count, page["total_count"])
                    self.assertEqual(int(count), len(cast(list[object], page["rows"])))

    def test_unknown_marketplaces_are_rejected_instead_of_ignored(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user in (
            self.operator(),
            self.member(company_a),
            self.member(company_b),
            self.auth_user(),
        ):
            for selection in (
                ["Unknown marketplace"],
                ["Amazon.com", "Unknown marketplace"],
                ["amazon.com"],
                ["Amazon.com", "AMAZON.COM"],
                [" Amazon.com"],
                ["Amazon.com "],
                [""],
            ):
                with (
                    self.subTest(selection=selection),
                    self.assertRaises(psycopg.errors.InvalidParameterValue),
                ):
                    self.count(user, p_marketplaces=selection)

    def test_invalid_date_bounds_are_rejected(self) -> None:
        operator = self.operator()
        invalid: tuple[dict[str, object], ...] = (
            {"p_date_from": "2026-06-17", "p_date_to": "2026-06-16"},
            {"p_date_from": "-infinity"},
            {"p_date_from": "infinity"},
            {"p_date_to": "-infinity"},
            {"p_date_to": "infinity"},
        )
        for options in invalid:
            with (
                self.subTest(options=options),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
            ):
                self.count(operator, **options)

    def test_invalid_filter_shapes_are_rejected(self) -> None:
        company, _ = self.owner()
        operator = self.operator()
        for name in _ARRAY_FILTERS:
            value = (
                company
                if name == "p_company_ids"
                else "Amazon.com"
                if name == "p_marketplaces"
                else "SKU"
            )
            for values in ([None], [value, None], [[value]]):
                with (
                    self.subTest(name=name, values=values),
                    self.assertRaises(psycopg.errors.InvalidParameterValue),
                ):
                    self.count(operator, **{name: values})
