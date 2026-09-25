"""Optimized literal search stays equivalent to the former view-level REST regex."""

from itertools import product
from typing import LiteralString, cast

import psycopg
from psycopg import sql

from services.db.supabase.tests import test_source_transaction_page as source_fixture
from services.db.supabase.tests import test_transaction_count as count_fixture
from services.db.supabase.tests import test_transaction_page as page_fixture
from services.db.supabase.tests.search_fixtures import JS_TRIM_CHARACTERS
from services.db.supabase.tests.source_fixtures import SourceModelFixture

_SOURCE_COUNT_TYPES = {
    "p_dataset": "text",
    "p_date_from": "date",
    "p_date_to": "date",
    "p_skus": "text[]",
    "p_marketplaces": "public.amazon_marketplace_name[]",
    "p_types": "text[]",
    "p_search": "text",
}


class TransactionSearchTests(SourceModelFixture):
    assign = page_fixture.TransactionPageTests.assign
    financial_fixture = page_fixture.TransactionPageTests.financial_fixture
    page = page_fixture.TransactionPageTests.page
    expected = page_fixture.TransactionPageTests.expected
    assert_matches_view = page_fixture.TransactionPageTests.assert_matches_view
    count = count_fixture.TransactionCountTests.count

    def test_visible_search_fields_and_short_terms_preserve_rows_counts_and_rls(self) -> None:
        company_a, company_b = self.financial_fixture()
        terms: tuple[object, ...] = (
            None,
            "",
            JS_TRIM_CHARACTERS,
            "settlement",
            "DATA_kiosk",
            "Data Kiosk",
            "settlements",
            "seller-one",
            "seller-two",
            "SKU",
            "other",
            "gap",
            "UNASSIGNED",
            "PRODUCT_REFUNDS",
            "fbaStorage",
            "usd",
            "v0",
            "applied",
            "NOT_APPLICABLE",
            "missing_fee",
            "missing_ownership",
            "missing",
            "i",
            "_",
            " ",
            " ",
            "0",
            "no matching result",
            "Principal",
            "5.125",
            "Amazon.com",
            "amazon.",
        )
        for user, term in product(
            (self.operator(), self.member(company_a), self.member(company_b), self.auth_user()),
            terms,
        ):
            with self.subTest(user=user, term=term):
                result = self.assert_matches_view(user, p_search=term, p_limit=1000)
                self.assertEqual(self.count(user, p_search=term), result["total_count"])

    def test_search_filters_precede_limits_for_both_orders_directions_and_counts(self) -> None:
        company_a, company_b = self.financial_fixture()
        selections: tuple[dict[str, object], ...] = (
            {"p_search": "NOT_APPLICABLE"},
            {"p_search": "missing"},
            {"p_search": "sku", "p_sources": ["SETTLEMENT"]},
            {"p_search": "v0", "p_types": ["PRODUCT_SALES"], "p_skus": ["SKU"]},
            {"p_search": "USD", "p_date_from": "2026-06-16", "p_date_to": "2026-07-01"},
            {"p_search": "applied", "p_fee_applicable": False},
            {"p_search": "seller", "p_fee_applicable": True, "p_company_ids": [company_b]},
            {"p_search": "PRODUCT", "p_marketplaces": ["Amazon.com"]},
        )
        for user, order, direction, selection, include_count in product(
            (self.operator(), self.member(company_a)),
            ("date", "amount"),
            ("asc", "desc"),
            selections,
            (True, False),
        ):
            with self.subTest(order=order, direction=direction, selection=selection):
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

    def test_regex_metacharacters_unicode_and_interior_whitespace_remain_literal(self) -> None:
        sku = "Literal.*+?^${}()|[]\\%,_\"'Ωä한국\ninside"
        company, _ = self.owner(sku)
        self.settlement([self.transaction("10", sku=sku), self.transaction("100", 4, sku="other")])
        self.kiosk(1, [self.component("-10", sku=sku), self.component("-100", sku="other")])
        terms = (
            ".",
            "*",
            "+",
            "?",
            "^",
            "$",
            "{",
            "}",
            "(",
            ")",
            "|",
            "[",
            "]",
            "\\",
            "%",
            '"',
            "'",
            "Ω",
            "Ä",
            "한국",
            "한국\ninside",
            "***=",
            "literal.*",
            "[[:space:]]",
        )
        for user, term in product((self.operator(), self.member(company)), terms):
            with self.subTest(term=term):
                result = self.assert_matches_view(user, p_search=term)
                self.assertEqual(self.count(user, p_search=term), result["total_count"])
        for whitespace in JS_TRIM_CHARACTERS:
            result = self.assert_matches_view(
                self.member(company), p_search=whitespace + "한국" + whitespace
            )
            self.assertEqual(result["total_count"], "2")

    def test_hidden_fields_do_not_match_and_membership_changes_apply_immediately(
        self,
    ) -> None:
        company_a, sku = self.owner()
        company_b, _ = self.owner("OTHER")
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        operator, member_a, member_b = (
            self.operator(),
            self.member(company_a),
            self.member(company_b),
        )
        acquisition = self.acquisition()
        _, settlement = self.settlement(
            [self.transaction("100")], acquisition_id=acquisition, version="old-label"
        )
        _, kiosk = self.kiosk(1, [self.component("-10") | {"fee_base": "-10"}], version="old-label")
        self.settlement(
            [self.transaction("200")],
            acquisition_id=acquisition,
            expected=settlement,
            version="NEW.[label]",
        )
        self.kiosk(
            2, [self.component("-20") | {"fee_base": "-20"}], expected=kiosk, version="NEW.[label]"
        )
        for user in (operator, member_a, member_b):
            for term in ("old-label", "new.[", "applied", "missing_fee"):
                result = self.assert_matches_view(user, p_search=term)
                self.assertEqual(self.count(user, p_search=term), result["total_count"])
                # Version and status metadata are no longer searchable.
                self.assertEqual(result["total_count"], "0")
        missing_terms = self.assign("SKU", company_b, expected=terms)
        self.assertEqual(self.assert_matches_view(member_a, p_search="missing")["total_count"], "0")
        self.assertEqual(self.assert_matches_view(member_b, p_search="SKU")["total_count"], "2")
        self.assign("SKU", None, expected=missing_terms)
        for user in (operator, member_a, member_b):
            result = self.assert_matches_view(user, p_search="SKU")
            self.assertEqual(self.count(user, p_search="SKU"), result["total_count"])
            self.assertEqual(result["total_count"], "2" if user == operator else "0")
        self.connection.execute("delete from public.app_accounts where user_id=%s", (operator,))
        self.assertEqual(self.assert_matches_view(operator, p_search="new.[")["total_count"], "0")
        self.assertEqual(self.count(operator, p_search="missing_ownership"), "0")


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

    def test_source_search_keeps_raw_column_scope_and_every_role_visibility(self) -> None:
        company_a, company_b = self.financial_fixture()
        terms: tuple[object, ...] = (
            None,
            "",
            JS_TRIM_CHARACTERS,
            "sku",
            "other",
            "unknown",
            "unassigned",
            "USD",
            "F1",
            "document",
            "product",
            "data_kiosk",
            "seller",
            "v0",
            "applied",
            "OPERATING_EXPENSE",
            "i",
            "Amazon.com",
            "PRODUCT",
            "FbaStorage",
        )
        for user, dataset, term in product(
            (self.operator(), self.member(company_a), self.member(company_b), self.auth_user()),
            ("settlement", "data_kiosk"),
            terms,
        ):
            with self.subTest(dataset=dataset, term=term):
                result = self.assert_matches_view(user, dataset, p_search=term, p_limit=1000)
                self.assertEqual(self.count(user, dataset, p_search=term), result["total_count"])

    def test_source_punctuation_precision_and_all_ordered_filtered_pages(self) -> None:
        company, _ = self.owner("Special.*[]\\\"'Ωä한국\ninside")
        sku = "Special.*[]\\\"'Ωä한국\ninside"
        transaction = self.transaction("100.123456789012345678901", sku=sku)
        transaction.update(family="family.[x]", accounting_subtype="OPERATING_EXPENSE")
        component = self.component("-100.123456789012345678901", sku=sku)
        component["source_document_id"] = "document.[x]"
        self.settlement([transaction, self.transaction("999", 4)])
        self.kiosk(1, [component, self.component("999"), self.component("0", sku=sku)])
        for user, dataset, term, order, direction in product(
            (self.operator(), self.member(company)),
            ("settlement", "data_kiosk"),
            (".", "[x]", "OPERATING", "family", "document", "Ä", "한국\ninside", '"', "\\", "[.*]"),
            ("date", "amount"),
            ("asc", "desc"),
        ):
            with self.subTest(dataset=dataset, term=term, order=order, direction=direction):
                filters = {
                    "p_search": term,
                    "p_date_from": "2026-06-15",
                    "p_date_to": "2026-06-15",
                    "p_marketplaces": ["Amazon.com"],
                    "p_skus": [sku],
                }
                for include_count in (True, False):
                    result = self.assert_matches_view(
                        user,
                        dataset,
                        p_order_by=order,
                        p_direction=direction,
                        p_limit=1,
                        p_include_count=include_count,
                        **filters,
                    )
                    if include_count:
                        self.assertEqual(
                            self.count(user, dataset, **filters), result["total_count"]
                        )

    def test_source_count_search_retains_operator_history_and_current_member_scope(self) -> None:
        company, sku = self.owner()
        operator, member = self.operator(), self.member(company)
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, settlement = self.settlement([self.transaction("10")], acquisition_id=acquisition)
        _, kiosk = self.kiosk(1, [self.component("10")])
        self.settlement([self.transaction("20")], acquisition_id=acquisition, expected=settlement)
        self.kiosk(2, [self.component("0")], expected=kiosk)
        for user, dataset in product((operator, member), ("settlement", "data_kiosk")):
            result = self.assert_matches_view(user, dataset, p_search="SKU")
            self.assertEqual(self.count(user, dataset, p_search="SKU"), result["total_count"])
        self.assign("SKU", None, expected=terms)
        for dataset in ("settlement", "data_kiosk"):
            self.assertEqual(self.count(member, dataset, p_search="SKU"), "0")
            self.assertEqual(
                self.count(operator, dataset, p_search="SKU"),
                "2" if dataset == "settlement" else "1",
            )

    def test_source_count_signature_invoker_grants_and_invalid_requests(self) -> None:
        page_fixture.assert_native_marketplace_contract(
            self, "source_transaction_count", _SOURCE_COUNT_TYPES
        )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.source_transaction_count('settlement')")
        operator = self.operator()
        for dataset in (None, "live", "settlement;select 1"):
            with self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.count(operator, dataset)
        for options in (
            {"p_date_from": "infinity"},
            {"p_date_from": "2026-06-16", "p_date_to": "2026-06-15"},
            {"p_skus": [None]},
            {"p_types": [["x"]]},
            {"p_marketplaces": [None]},
        ):
            with self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.count(operator, "settlement", **options)
        with self.assertRaises(psycopg.errors.InvalidTextRepresentation):
            self.count(operator, "data_kiosk", p_marketplaces=["Not a marketplace"])
