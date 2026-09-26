"""Only operators can read frozen payouts and their complete input inventories."""

from decimal import Decimal
from typing import LiteralString

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class PayoutReportAccessTests(SourceModelFixture):
    def test_all_report_reads_are_operator_only_including_exclusion_evidence(self) -> None:
        company, identity = self.owner()
        other_company, _ = self.owner("OTHER")
        self.fee(identity, [("2026-01-01", None, "5")])
        settlement, _ = self.settlement([self.transaction("100")])
        self.kiosk(1, [self.component(), self.component("-20", sku="OTHER")])
        report = self.call(
            "publish_company_payout_report",
            {
                "id": new_id(),
                "company_id": company,
                "seller_namespace": self.seller,
                "currency": "USD",
                "start_date": "2026-06-15",
                "end_date": "2026-06-15",
                "preprocess_version": "v0",
                "settlement_ids": [settlement],
                "marketplace_names": ["Amazon.com"],
                "dataset_key": "economics",
                "report_name": "Complete source access",
                "change_reason": "Freeze both source manifests and exclusion evidence",
            },
        )
        operator = self.operator()
        unconfigured = self.auth_user()
        denied_users = (self.member(company), self.member(other_company), unconfigured)
        self.connection.execute("set constraints all immediate")
        self.assertEqual(
            self.as_user(
                operator,
                "select id::text,company_id::text,component_count,settlement_version_count,"
                "data_kiosk_version_count,terms_version_count,company_amount "
                "from public.company_payout_reports",
            ),
            [(report, company, 2, 1, 1, 2, Decimal(85))],
        )
        queries: tuple[tuple[LiteralString, int], ...] = (
            ("select * from public.company_payout_reports", 1),
            ("select * from public.company_payout_report_components", 2),
            ("select * from public.payout_report_settlement_versions", 1),
            ("select * from public.payout_report_data_kiosk_versions", 1),
            ("select * from public.payout_report_terms_versions", 2),
            ("select * from private.payout_report_settlement_versions", 1),
            ("select * from private.payout_report_data_kiosk_versions", 1),
            ("select * from private.payout_report_terms_versions", 2),
        )
        for query, expected_count in queries:
            with self.subTest(query=query):
                self.assertEqual(len(self.as_user(operator, query)), expected_count)
                for user in denied_users:
                    self.assertEqual(self.as_user(user, query), [])
