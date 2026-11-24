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
        {"p_search_marketplaces": ["Unknown"]},
        {"p_search_marketplaces": ["Amazon.com') OR true --"]},
        {"p_search_marketplaces": ["Unknown", "Amazon.com"]},
        {"p_search_skus": ["OTHER"], "p_search_types": ["PRODUCT_SALES"]},
        {"p_search_skus": [], "p_search_types": ["FbaStorageFee"], "p_search_marketplaces": []},
    )
    extra: tuple[dict[str, object], ...] = (
        (
            {"p_search_sources": ["AD_INVOICE"]},
            {"p_search_sources": ["FINANCES"], "p_search_skus": ["OTHER"]},
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
            (
                self.administrator(),
                self.member(company_a),
                self.member(company_b),
                self.auth_user(),
            ),
            selections(live=True),
        ):
            with self.subTest(selection=selection):
                result = self.assert_matches_view(user, p_limit=1000, **selection)
                self.assertEqual(self.count(user, **selection), result["total_count"])
        administrator = self.administrator()
        self.assertEqual(self.count(administrator, p_search_skus=[]), "0")
        self.assertEqual(self.count(administrator, p_search_skus=["sku"]), "0")
        self.assertGreater(int(self.count(administrator, p_search_skus=["SKU"])), 0)
        self.assertEqual(
            self.count(administrator, **dict.fromkeys(LIVE_SEARCH_FIELDS, None)),
            self.count(administrator),
        )

    def test_search_and_selection_filters_precede_pagination_and_amount_cap(self) -> None:
        company_a, company_b = self.financial_fixture()
        filters = (
            {"p_search_skus": ["SKU"], "p_sources": ["FINANCES"]},
            {"p_search_types": ["PRODUCT_SALES"], "p_types": ["FbaStorageFee"]},
            {"p_search_marketplaces": ["Amazon.com"], "p_date_from": "2026-06-16"},
            {"p_search_types": ["PRODUCT_SALES", "FbaStorageFee"], "p_fee_applicable": False},
            {"p_search_skus": ["SKU"], "p_company_ids": [company_b]},
            {"p_search_sources": ["AD_INVOICE"], "p_marketplaces": ["Amazon.co.uk"]},
        )
        for user, order, direction, selection, include_count in product(
            (self.administrator(), self.member(company_a)),
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

    def test_invalid_search_shapes_are_rejected_by_both_live_rpcs(self) -> None:
        user = self.administrator()
        for field in LIVE_SEARCH_FIELDS:
            value = "Amazon.com" if field == "p_search_marketplaces" else "SKU"
            for selection in ([None], [value, None], [[value]]):
                for call in (self.page, self.count):
                    with (
                        self.subTest(field=field),
                        self.assertRaises(psycopg.errors.InvalidParameterValue),
                    ):
                        call(user, **{field: selection})


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

    def test_source_count_contract_and_invalid_search_requests(self) -> None:
        assert_rpc_contract(self, "source_transaction_count", _SOURCE_COUNT_TYPES)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.source_transaction_count('finances')")
        administrator = self.administrator()
        for dataset in (None, "live", "finances;select 1"):
            with self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.count(administrator, dataset)
        for field in SOURCE_SEARCH_FIELDS:
            value = "Amazon.com" if field == "p_search_marketplaces" else "SKU"
            for selection in ([None], [value, None], [[value]]):
                for call in (self.page, self.count):
                    with self.assertRaises(psycopg.errors.InvalidParameterValue):
                        call(administrator, "finances", **{field: selection})
