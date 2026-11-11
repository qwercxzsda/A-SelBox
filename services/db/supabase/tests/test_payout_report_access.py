"""Members read their frozen payouts; full input inventories remain administrator-only."""

from decimal import Decimal
from typing import LiteralString, cast

import psycopg

from services.db.supabase.tests.payout_fixtures import fill_payout_kiosk_month, report_records
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class PayoutReportAccessTests(SourceModelFixture):
    def test_members_read_only_their_reports_and_never_exclusion_evidence(self) -> None:
        company, identity = self.owner()
        other_company, _ = self.owner("OTHER")
        self.fee(identity, [("2026-01-01", None, "5")])
        self.finances([self.transaction("100")])
        self.kiosk(
            1,
            [
                self.component(),
                self.component("-20", sku="OTHER"),
                self.component("0", category="ANALYSIS_ONLY")
                | {"component_type": "UNKNOWN_ZERO_DETAIL"},
                self.component("0", category="ANALYSIS_ONLY")
                | {"component_type": "UNKNOWN_QUANTITY_DETAIL", "quantity": "2"},
                self.component("500", category="FINANCES"),
            ],
        )
        fill_payout_kiosk_month(self)
        report = self.call(
            "publish_company_payout_report",
            {
                "id": new_id(),
                "company_id": company,
                "marketplace_name": "Amazon.com",
                "currency": "USD",
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "dataset_key": "economics",
                "change_reason": "Freeze both source manifests and exclusion evidence",
            },
        )
        administrator = self.administrator()
        unconfigured = self.auth_user()
        owner = self.member(company)
        denied_users = (self.member(other_company), unconfigured)
        self.connection.execute("set constraints all immediate")
        self.assertEqual(
            self.as_user(
                administrator,
                "select id::text,company_id::text,component_count,finances_version_count,"
                "data_kiosk_version_count,terms_version_count,company_amount "
                "from public.company_payout_reports",
            ),
            [(report, company, 5, 1, 30, 2, Decimal(85))],
        )
        queries: tuple[tuple[LiteralString, int, int], ...] = (
            ("select * from public.company_payout_reports", 1, 1),
            ("select * from public.latest_company_payout_reports", 1, 1),
            (
                "select * from public.latest_company_payout_reports "
                "where start_date = '2026-06-01'",
                1,
                1,
            ),
            ("select * from public.payout_report_finances_versions", 1, 0),
            ("select * from public.payout_report_data_kiosk_versions", 30, 0),
            ("select * from public.payout_report_terms_versions", 2, 0),
            ("select * from private.payout_report_finances_versions", 1, 0),
            ("select * from private.payout_report_data_kiosk_versions", 30, 0),
            ("select * from private.payout_report_terms_versions", 2, 0),
        )
        for query, administrator_count, member_count in queries:
            with self.subTest(query=query):
                self.assertEqual(len(self.as_user(administrator, query)), administrator_count)
                self.assertEqual(len(self.as_user(owner, query)), member_count)
                for user in denied_users:
                    self.assertEqual(self.as_user(user, query), [])
        self.assertEqual(len(report_records(self, report, user=administrator)), 5)
        member_records = report_records(self, report, user=owner)
        self.assertEqual(len(member_records), 2)
        self.assertTrue(all(row["authoritative"] == "true" for row in member_records))
        self.assertEqual(
            len(report_records(self, report, user=administrator, authoritative=False)), 3
        )
        for user in denied_users:
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                report_records(self, report, user=user)
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(user, "select public.payout_report_totals(%s)", (report,))
        for user in (owner, administrator):
            for query in (
                "select public.payout_report_records(%s)",
                "select public.payout_report_totals(%s)",
            ):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.as_user(user, query, (new_id(),))
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            report_records(self, report, user=owner, authoritative=False)
        coverage = cast(
            list[dict[str, str]],
            self.as_user(
                owner,
                "select source_coverage from public.company_payout_reports where id=%s",
                (report,),
            )[0][0],
        )
        self.assertEqual({row["source"] for row in coverage}, {"FINANCES", "DATA_KIOSK"})
        for interval in coverage:
            self.assertEqual(
                set(interval),
                {"source", "seller_namespace", "marketplace_name", "start_date", "end_date"},
            )
            self.assertEqual(interval["seller_namespace"], self.seller)
            self.assertEqual(interval["marketplace_name"], "Amazon.com")
            self.assertEqual(interval["start_date"], "2026-06-01")
            self.assertEqual(interval["end_date"], "2026-06-30")
        for user in (owner, *denied_users):
            with (
                self.subTest(source_totals_user=user),
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
            ):
                self.as_user(user, "select public.report_source_totals(%s)", (report,))
        self.assertEqual(
            self.as_user(
                owner, "select start_date::text from public.latest_company_payout_reports"
            ),
            [("2026-06-01",)],
        )
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
