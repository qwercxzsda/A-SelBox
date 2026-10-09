"""Current SKU assignments control new payout work without erasing saved reports."""

from datetime import date

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import (
    empty_report_payload,
    generate_payout_reports,
    payout_snapshot,
    prepare_payout,
    reassign_payout_sku,
    refresh_payout_reports,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class PayoutCompanyEligibilityTests(SourceModelFixture):
    def empty_company(self) -> str:
        company = new_id()
        self.connection.execute(
            "insert into public.companies(id,name) values (%s,'No assigned SKUs')", (company,)
        )
        return company

    def assert_no_work(self, company: str) -> None:
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.payout_report_refresh_state where company_id=%s",
                (company,),
            ).fetchone(),
            (0,),
        )

    def test_membership_and_unrelated_source_history_never_enqueue_or_generate(self) -> None:
        inputs = prepare_payout(self)
        company, member_company = self.empty_company(), self.empty_company()
        self.member(member_company)
        for target in (company, member_company):
            self.connection.execute(
                "select private.request_payout_report_refresh(array[date '2026-05-01'],"
                "array[%s::uuid])",
                (target,),
            )
            self.connection.execute(
                "select private.request_all_payout_report_refreshes(array[%s::uuid])", (target,)
            )
            self.assert_no_work(target)
            self.assertEqual(generate_payout_reports(self, target), [])
        self.connection.execute("select private.request_all_payout_report_refreshes()")
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select company_id::text from public.company_payout_reports"
            ).fetchall(),
            [(inputs.company,)],
        )
        for target in (company, member_company):
            self.assert_no_work(target)

    def test_low_level_publisher_rejects_company_without_current_assignment(self) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        company = self.empty_company()
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "currently assigned SKU"),
            self.connection.transaction(),
        ):
            self.call("publish_company_payout_report", empty_report_payload(company))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )

    def test_first_assignment_bootstraps_known_months_even_without_sales_or_members(self) -> None:
        prepare_payout(self)
        self.set_mature_cutoff_date(date(2026, 8, 1))
        refresh_payout_reports(self)
        company, _ = self.owner("NEW-SKU-WITHOUT-SALES")
        self.assertEqual(
            self.connection.execute(
                "select month from private.payout_report_refresh_state where company_id=%s "
                "order by month",
                (company,),
            ).fetchall(),
            [(date(2026, 6, 1),), (date(2026, 7, 1),), (date(2026, 8, 1),)],
        )
        self.assertEqual(refresh_payout_reports(self), (2, 2, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select currency,company_amount,terms_version_count "
                "from public.company_payout_reports "
                "where company_id=%s order by start_date",
                (company,),
            ).fetchall(),
            [(None, 0, 1), (None, 0, 1)],
        )

    def test_losing_last_sku_stops_new_reports_and_reassignment_catches_up(self) -> None:
        inputs = prepare_payout(self)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        report = str(
            require_row(
                self.connection.execute("select id from public.company_payout_reports").fetchone()
            )[0]
        )
        snapshot = payout_snapshot(self, report)
        reassign_payout_sku(self, inputs.sku_identity, None)
        self.assert_no_work(inputs.company)
        self.set_mature_cutoff_date(date(2026, 8, 1))
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
        self.assertEqual(generate_payout_reports(self, inputs.company), [])
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "currently assigned SKU"),
            self.connection.transaction(),
        ):
            self.call("publish_company_payout_report", empty_report_payload(inputs.company))
        self.assertEqual(payout_snapshot(self, report), snapshot)
        reassign_payout_sku(self, inputs.sku_identity, inputs.company)
        self.assertEqual(refresh_payout_reports(self), (2, 2, 0, 0))
        self.assertEqual(payout_snapshot(self, report), snapshot)
        self.assertEqual(
            self.connection.execute(
                "select start_date,company_amount from public.latest_company_payout_reports "
                "where company_id=%s order by start_date",
                (inputs.company,),
            ).fetchall(),
            [(date(2026, 6, 1), 85), (date(2026, 7, 1), 0)],
        )

    def test_stale_ineligible_queue_does_not_consume_worker_limit_or_seed_history(self) -> None:
        inputs = prepare_payout(self)
        company = self.empty_company()
        self.connection.execute(
            "insert into private.payout_report_refresh_state(company_id,month,next_attempt_at) "
            "values (%s,'1800-01-01','-infinity'),(%s,'2026-06-01','-infinity')",
            (company, company),
        )
        # Bootstrap another eligible company while stale work still exists.
        self.owner("OTHER-NO-SALES")
        self.assert_no_work(company)
        self.assertEqual(
            self.connection.execute(
                "select min(month) from private.payout_report_refresh_state"
            ).fetchone(),
            (date(2026, 6, 1),),
        )
        # Reinsert stale work to exercise cron cleanup separately from invalidation.
        self.connection.execute(
            "insert into private.payout_report_refresh_state(company_id,month,next_attempt_at) "
            "values (%s,'2026-06-01','-infinity')",
            (company,),
        )
        self.assertEqual(refresh_payout_reports(self, 1), (1, 1, 0, 0))
        self.assert_no_work(company)
        self.assertEqual(
            self.connection.execute(
                "select company_id::text from public.company_payout_reports"
            ).fetchall(),
            [(inputs.company,)],
        )
