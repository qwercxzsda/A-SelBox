"""Members read their frozen payouts; full input inventories remain operator-only."""

from decimal import Decimal
from typing import LiteralString

from services.db.supabase.tests.payout_fixtures import fill_payout_kiosk_month
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class PayoutReportAccessTests(SourceModelFixture):
    def test_members_read_only_their_reports_and_never_exclusion_evidence(self) -> None:
        company, identity = self.owner()
        other_company, _ = self.owner("OTHER")
        self.fee(identity, [("2026-01-01", None, "5")])
        self.settlement([self.transaction("100")])
        self.kiosk(
            1,
            [
                self.component(),
                self.component("-20", sku="OTHER"),
                self.component("0", category="ANALYSIS_ONLY")
                | {"component_type": "UNKNOWN_ZERO_DETAIL"},
                self.component("0", category="ANALYSIS_ONLY")
                | {"component_type": "UNKNOWN_QUANTITY_DETAIL", "quantity": "2"},
                self.component("500", category="SETTLEMENT"),
            ],
        )
        fill_payout_kiosk_month(self)
        report = self.call(
            "publish_company_payout_report",
            {
                "id": new_id(),
                "company_id": company,
                "currency": "USD",
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "dataset_key": "economics",
                "report_name": "Complete source access",
                "change_reason": "Freeze both source manifests and exclusion evidence",
            },
        )
        operator = self.operator()
        unconfigured = self.auth_user()
        owner = self.member(company)
        denied_users = (self.member(other_company), unconfigured)
        self.connection.execute("set constraints all immediate")
        self.assertEqual(
            self.as_user(
                operator,
                "select id::text,company_id::text,component_count,settlement_version_count,"
                "data_kiosk_version_count,terms_version_count,company_amount "
                "from public.company_payout_reports",
            ),
            [(report, company, 5, 1, 30, 2, Decimal(85))],
        )
        queries: tuple[tuple[LiteralString, int, int], ...] = (
            ("select * from public.company_payout_reports", 1, 1),
            ("select * from public.company_payout_report_components", 5, 2),
            (
                "select * from public.company_payout_report_components where not authoritative",
                3,
                0,
            ),
            ("select * from public.payout_report_settlement_versions", 1, 0),
            ("select * from public.payout_report_data_kiosk_versions", 30, 0),
            ("select * from public.payout_report_terms_versions", 2, 0),
            ("select * from private.payout_report_settlement_versions", 1, 0),
            ("select * from private.payout_report_data_kiosk_versions", 30, 0),
            ("select * from private.payout_report_terms_versions", 2, 0),
            ("select * from public.payout_report_reconciliation", 1, 0),
            ("select * from private.payout_report_reconciliation", 1, 0),
            ("select * from public.payout_reconciliation_totals", 1, 0),
        )
        for query, operator_count, member_count in queries:
            with self.subTest(query=query):
                self.assertEqual(len(self.as_user(operator, query)), operator_count)
                self.assertEqual(len(self.as_user(owner, query)), member_count)
                for user in denied_users:
                    self.assertEqual(self.as_user(user, query), [])
        self.assertEqual(
            self.as_user(
                owner,
                "select public.payout_report_totals(%s)::jsonb->'rows'",
                (report,),
            ),
            [
                (
                    [
                        {
                            "currency": "USD",
                            "component_type": None,
                            "reported_amount": "90",
                            "service_fee": "-5.00",
                            "company_amount": "85.00",
                            "row_count": "2",
                            "known_company_count": "2",
                        }
                    ],
                )
            ],
        )
