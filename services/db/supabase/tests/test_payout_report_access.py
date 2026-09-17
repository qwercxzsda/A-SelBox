"""Only operators can read frozen payouts and their complete input inventories."""

from decimal import Decimal
from typing import LiteralString

from services.db.supabase.tests.payout_fixtures import publish_report
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutReportAccessTests(SourceModelFixture):
    def test_all_report_reads_are_operator_only_including_exclusion_evidence(self) -> None:
        company, _ = self.owner()
        other_company, _ = self.owner("OTHER")
        self.kiosk(1, [self.component(), self.component("-20", sku="OTHER")])
        report = publish_report(self, company)
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
            [(report, company, 1, 0, 1, 2, Decimal(-10))],
        )
        queries: tuple[tuple[LiteralString, int], ...] = (
            ("select * from public.company_payout_reports", 1),
            ("select * from public.company_payout_report_components", 1),
            ("select * from public.payout_report_settlement_versions", 0),
            ("select * from public.payout_report_data_kiosk_versions", 1),
            ("select * from public.payout_report_terms_versions", 2),
            ("select * from private.payout_report_settlement_versions", 0),
            ("select * from private.payout_report_data_kiosk_versions", 1),
            ("select * from private.payout_report_terms_versions", 2),
        )
        for query, expected_count in queries:
            with self.subTest(query=query):
                self.assertEqual(len(self.as_user(operator, query)), expected_count)
                for user in denied_users:
                    self.assertEqual(self.as_user(user, query), [])
