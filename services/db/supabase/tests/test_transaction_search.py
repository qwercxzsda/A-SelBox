"""Resolved search OR-sets preserve exact amounts, ordering, counts and RLS."""

from itertools import product
from typing import LiteralString, cast

import psycopg
from psycopg import sql

from services.db.supabase.tests import test_source_transaction_page as source_fixture
from services.db.supabase.tests import test_transaction_count as count_fixture
from services.db.supabase.tests import test_transaction_page as page_fixture
from services.db.supabase.tests.rpc_support import assert_rpc_contract
from services.db.supabase.tests.search_fixtures import LIVE_SEARCH_FIELDS, SOURCE_SEARCH_FIELDS
from services.db.supabase.tests.source_fixtures import SourceModelFixture

_SOURCE_COUNT_TYPES = {
    "p_dataset": "text",
    "p_date_from": "date",
    "p_date_to": "date",
    "p_skus": "text[]",
    "p_marketplaces": "text[]",
    "p_types": "text[]",
    **dict.fromkeys(SOURCE_SEARCH_FIELDS, "text[]"),
}


def selections(*, live: bool) -> tuple[dict[str, object], ...]:
    fields = LIVE_SEARCH_FIELDS if live else SOURCE_SEARCH_FIELDS
    result: tuple[dict[str, object], ...] = (
        {},
        dict.fromkeys(fields, cast(object, None)),
        {name: [] for name in fields},
        {"p_search_skus": []},
        {"p_search_skus": ["SKU"]},
        {"p_search_skus": ["sku"]},
        {"p_search_skus": ["SKU", "SKU", "OTHER"]},
        {"p_search_skus": ["UNASSIGNED", "unknown"]},
        {"p_search_types": ["PRODUCT_SALES", "FbaStorageFee"]},
        {"p_search_marketplaces": ["Amazon.com"]},
        {"p_search_marketplaces": ["Amazon.co.uk"]},
        {"p_search_skus": ["OTHER"], "p_search_types": ["PRODUCT_SALES"]},
        {"p_search_skus": [], "p_search_types": ["FbaStorageFee"], "p_search_marketplaces": []},
    )
    extra: tuple[dict[str, object], ...] = (
        (
            {"p_search_sources": ["DATA_KIOSK"]},
            {"p_search_sources": ["SETTLEMENT"], "p_search_skus": ["OTHER"]},
        )
        if live
        else ()
    )
    return result + extra


class TransactionSearchTests(SourceModelFixture):
    assign = page_fixture.TransactionPageTests.assign
    financial_fixture = page_fixture.TransactionPageTests.financial_fixture
    page = page_fixture.TransactionPageTests.page
    expected = page_fixture.TransactionPageTests.expected
    assert_matches_view = page_fixture.TransactionPageTests.assert_matches_view
    count = count_fixture.TransactionCountTests.count

    def test_or_sets_match_authorized_views_and_exact_counts(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user, selection in product(
            (self.operator(), self.member(company_a), self.member(company_b), self.auth_user()),
            selections(live=True),
        ):
            with self.subTest(selection=selection):
                result = self.assert_matches_view(user, p_limit=1000, **selection)
                self.assertEqual(self.count(user, **selection), result["total_count"])
        operator = self.operator()
        self.assertEqual(self.count(operator, p_search_skus=[]), "0")
        self.assertEqual(self.count(operator, p_search_skus=["sku"]), "0")
        self.assertGreater(int(self.count(operator, p_search_skus=["SKU"])), 0)
        self.assertEqual(
            self.count(operator, **dict.fromkeys(LIVE_SEARCH_FIELDS, None)), self.count(operator)
        )

    def test_search_and_selection_filters_precede_pagination_and_amount_cap(self) -> None:
        company_a, company_b = self.financial_fixture()
        filters = (
            {"p_search_skus": ["SKU"], "p_sources": ["SETTLEMENT"]},
            {"p_search_types": ["PRODUCT_SALES"], "p_types": ["FbaStorageFee"]},
            {"p_search_marketplaces": ["Amazon.com"], "p_date_from": "2026-06-16"},
            {"p_search_types": ["PRODUCT_SALES", "FbaStorageFee"], "p_fee_applicable": False},
            {"p_search_skus": ["SKU"], "p_company_ids": [company_b]},
            {"p_search_sources": ["DATA_KIOSK"], "p_marketplaces": ["Amazon.co.uk"]},
        )
        for user, order, direction, selection, include_count in product(
            (self.operator(), self.member(company_a)),
            ("date", "amount"),
            ("asc", "desc"),
            filters,
            (True, False),
        ):
            result = self.assert_matches_view(
                user,
                p_order_by=order,
                p_direction=direction,
                p_limit=1,
                p_offset=1,
                p_include_count=include_count,
                **selection,
            )
            if include_count:
                self.assertEqual(self.count(user, **selection), result["total_count"])

    def test_catalog_values_are_exact_including_punctuation_unicode_and_whitespace(self) -> None:
        sku = " Literal.*[]\\%,_\"'Ωä한국\ninside "
        company, _ = self.owner(sku)
        self.settlement([self.transaction("100.123456789012345678901", sku=sku)])
        self.kiosk(1, [self.component("-100.123456789012345678901", sku=sku)])
        for user in (self.operator(), self.member(company)):
            self.assertEqual(
                self.assert_matches_view(user, p_search_skus=[sku])["total_count"], "2"
            )
            for absent in (sku.strip(), sku.lower(), ".*", "USD", "APPLIED", "seller"):
                self.assertEqual(self.count(user, p_search_skus=[absent]), "0")
            self.assertEqual(self.count(user, p_search_types=["USD"]), "0")

    def test_search_cannot_bypass_current_ownership_or_account_revocation(self) -> None:
        company_a, sku = self.owner()
        company_b, _ = self.owner("OTHER")
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        operator, member_a, member_b = (
            self.operator(),
            self.member(company_a),
            self.member(company_b),
        )
        acquisition = self.acquisition()
        _, old = self.settlement([self.transaction("100")], acquisition_id=acquisition)
        self.settlement([self.transaction("200")], acquisition_id=acquisition, expected=old)
        self.kiosk(1, [self.component("-20")])
        new_terms = self.assign("SKU", company_b, expected=terms)
        self.assertEqual(self.count(member_a, p_search_skus=["SKU"]), "0")
        self.assertEqual(self.count(member_b, p_search_skus=["SKU"]), "2")
        self.assign("SKU", None, expected=new_terms)
        for user in (operator, member_a, member_b):
            result = self.assert_matches_view(user, p_search_skus=["SKU"])
            self.assertEqual(result["total_count"], "2" if user == operator else "0")
        self.connection.execute("delete from public.app_accounts where user_id=%s", (operator,))
        self.assertEqual(self.count(operator, p_search_sources=["SETTLEMENT", "DATA_KIOSK"]), "0")

    def test_invalid_search_shapes_are_rejected_by_both_live_rpcs(self) -> None:
        user = self.operator()
        for field in LIVE_SEARCH_FIELDS:
            value = "Amazon.com" if field == "p_search_marketplaces" else "SKU"
            for selection in ([None], [value, None], [[value]]):
                for call in (self.page, self.count):
                    with (
                        self.subTest(field=field),
                        self.assertRaises(psycopg.errors.InvalidParameterValue),
                    ):
                        call(user, **{field: selection})
        for call in (self.page, self.count):
            with self.assertRaises(psycopg.errors.InvalidParameterValue):
                call(user, p_search_marketplaces=["Unknown"])


class SourceTransactionSearchTests(SourceModelFixture):
    assign = source_fixture.SourceTransactionPageTests.assign
    financial_fixture = source_fixture.SourceTransactionPageTests.financial_fixture
    page = source_fixture.SourceTransactionPageTests.page
    expected = source_fixture.SourceTransactionPageTests.expected
    assert_matches_view = source_fixture.SourceTransactionPageTests.assert_matches_view

    def count(self, user: str, dataset: object, **options: object) -> str:
        options = {"p_dataset": dataset, **options}
        arguments = sql.SQL(", ").join(
            sql.SQL("{} => %s::{}").format(
                sql.Identifier(name), sql.SQL(cast(LiteralString, _SOURCE_COUNT_TYPES[name]))
            )
            for name in options
        )
        query = sql.SQL("select public.source_transaction_count({})").format(arguments)
        result = self.as_user(
            user, cast(LiteralString, query.as_string(self.connection)), tuple(options.values())
        )[0][0]
        self.assertIsInstance(result, str)
        self.assertTrue(cast(str, result).isdecimal())
        return cast(str, result)

    def test_source_search_or_sets_keep_history_roles_order_and_filters(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user, dataset, selection, order in product(
            (self.operator(), self.member(company_a), self.member(company_b), self.auth_user()),
            ("settlement", "data_kiosk"),
            selections(live=False),
            ("date", "amount"),
        ):
            result = self.assert_matches_view(
                user, dataset, p_limit=2, p_offset=1, p_order_by=order, **selection
            )
            self.assertEqual(self.count(user, dataset, **selection), result["total_count"])
        for dataset, direction, include_count in product(
            ("settlement", "data_kiosk"), ("asc", "desc"), (True, False)
        ):
            self.assert_matches_view(
                self.member(company_a),
                dataset,
                p_search_skus=["SKU"],
                p_search_types=["FbaStorageFee"],
                p_types=["PRODUCT_SALES"],
                p_marketplaces=["Amazon.com"],
                p_date_from="2026-06-15",
                p_direction=direction,
                p_include_count=include_count,
            )

    def test_source_count_retains_operator_history_and_current_member_scope(self) -> None:
        company, sku = self.owner()
        operator, member = self.operator(), self.member(company)
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, settlement = self.settlement([self.transaction("10")], acquisition_id=acquisition)
        _, kiosk = self.kiosk(1, [self.component("10")])
        self.settlement([self.transaction("20")], acquisition_id=acquisition, expected=settlement)
        self.kiosk(2, [self.component("0")], expected=kiosk)
        for user, dataset in product((operator, member), ("settlement", "data_kiosk")):
            result = self.assert_matches_view(user, dataset, p_search_skus=["SKU"])
            self.assertEqual(
                self.count(user, dataset, p_search_skus=["SKU"]), result["total_count"]
            )
        self.assign("SKU", None, expected=terms)
        for dataset in ("settlement", "data_kiosk"):
            self.assertEqual(self.count(member, dataset, p_search_skus=["SKU"]), "0")
            self.assertEqual(
                self.count(operator, dataset, p_search_skus=["SKU"]),
                "2" if dataset == "settlement" else "1",
            )

    def test_source_count_contract_and_invalid_search_requests(self) -> None:
        assert_rpc_contract(self, "source_transaction_count", _SOURCE_COUNT_TYPES)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.source_transaction_count('settlement')")
        operator = self.operator()
        for dataset in (None, "live", "settlement;select 1"):
            with self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.count(operator, dataset)
        for field in SOURCE_SEARCH_FIELDS:
            value = "Amazon.com" if field == "p_search_marketplaces" else "SKU"
            for selection in ([None], [value, None], [[value]]):
                for call in (self.page, self.count):
                    with self.assertRaises(psycopg.errors.InvalidParameterValue):
                        call(operator, "settlement", **{field: selection})
        for call in (self.page, self.count):
            with self.assertRaises(psycopg.errors.InvalidParameterValue):
                call(operator, "data_kiosk", p_search_marketplaces=["Unknown"])
