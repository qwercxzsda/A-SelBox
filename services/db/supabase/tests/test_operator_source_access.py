"""Operators retain source history while members see only current owned facts."""

from decimal import Decimal
from typing import LiteralString

import psycopg

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class OperatorSourceAccessTests(SourceModelFixture):
    def test_source_rows_and_result_headers_preserve_the_role_boundary(self) -> None:
        company, _ = self.owner()
        self.owner("OTHER")
        member, operator = self.member(company), self.operator()
        acquisition = self.acquisition()
        _, settlement_version = self.settlement(
            [
                self.transaction("100"),
                self.transaction("500", 4, sku="OTHER"),
                self.transaction("-10", 5, category="SELBOX", kind="AccountFee")
                | {"family": "F5", "sku": None},
            ],
            acquisition_id=acquisition,
        )
        self.settlement(
            [self.transaction("200"), self.transaction("600", 4, sku="OTHER")],
            acquisition_id=acquisition,
            expected=settlement_version,
        )
        _, kiosk_version = self.kiosk(1, [self.component("-1")])
        self.kiosk(
            2,
            [
                self.component("-2"),
                self.component("-60", sku="OTHER"),
                self.component("-20", category="SELBOX") | {"sku": None},
            ],
            expected=kiosk_version,
        )
        self.connection.execute("set constraints all immediate")
        queries: tuple[tuple[LiteralString, list[int], list[int]], ...] = (
            (
                "select amount from private.settlement_transactions order by amount",
                [200],
                [-10, 100, 200, 500, 600],
            ),
            (
                "select amount from public.settlement_preprocess_entries order by amount",
                [200],
                [-10, 100, 200, 500, 600],
            ),
            (
                "select amount from private.data_kiosk_transactions order by amount",
                [-2],
                [-60, -20, -2, -1],
            ),
            (
                "select amount from public.data_kiosk_preprocess_entries order by amount",
                [-2],
                [-60, -20, -2, -1],
            ),
        )
        for query, member_amounts, operator_amounts in queries:
            with self.subTest(query=query):
                self.assertEqual(
                    self.as_user(member, query), [(Decimal(x),) for x in member_amounts]
                )
                self.assertEqual(
                    self.as_user(operator, query), [(Decimal(x),) for x in operator_amounts]
                )
        for query in (
            "select * from public.settlement_preprocess_results",
            "select * from public.data_kiosk_preprocess_results",
        ):
            with self.subTest(query=query):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.as_user(member, query)
                self.assertEqual(len(self.as_user(operator, query)), 2)
        historical_queries: tuple[tuple[LiteralString, str], ...] = (
            (
                "select id from public.settlement_preprocess_entries where version_id=%s",
                settlement_version,
            ),
            (
                "select id from public.data_kiosk_preprocess_entries where version_id=%s",
                kiosk_version,
            ),
        )
        for query, version in historical_queries:
            self.assertEqual(self.as_user(member, query, (version,)), [])

    def test_operator_reads_unassigned_identity_and_all_terms_revisions(self) -> None:
        company, identity = self.owner()
        member, operator = self.member(company), self.operator()
        first = self.fee(identity, [("2026-01-01", None, "5")])
        second = self.fee(identity, [("2026-01-01", None, "7")])
        self.assertEqual(
            self.as_user(member, "select id::text from public.sku_terms_versions"), [(second,)]
        )
        self.assertEqual(
            self.as_user(
                operator,
                "select fee_rate_percent from public.sku_fee_periods order by fee_rate_percent",
            ),
            [(Decimal(5),), (Decimal(7),)],
        )
        self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": identity,
                "sku": "SKU",
                "company_id": None,
                "expected_current_version_id": second,
                "change_reason": "Unassign current ownership",
                "periods": [],
            },
        )
        self.assertEqual(self.as_user(member, "select * from public.skus"), [])
        self.assertEqual(self.as_user(member, "select * from public.sku_terms_versions"), [])
        self.assertEqual(self.as_user(member, "select * from public.sku_fee_periods"), [])
        self.assertEqual(len(self.as_user(operator, "select * from public.skus")), 1)
        self.assertEqual(len(self.as_user(operator, "select * from public.sku_terms_versions")), 4)
        self.assertEqual(
            self.as_user(
                operator, "select id::text from public.sku_terms_versions where id=%s", (first,)
            ),
            [(first,)],
        )
