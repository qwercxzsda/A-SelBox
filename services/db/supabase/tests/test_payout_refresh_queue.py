"""Pending metadata keeps idle work cheap and failed work bounded."""

from datetime import date
from typing import cast

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import prepare_payout, refresh_payout_reports
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutRefreshQueueTests(SourceModelFixture):
    def queue_state(self, company: str) -> tuple[int, int, int, bool]:
        return cast(
            tuple[int, int, int, bool],
            require_row(
                self.connection.execute(
                    "select requested_revision,completed_revision,failure_count,"
                    "next_attempt_at > clock_timestamp() from private.payout_report_refresh_state "
                    "where company_id=%s and month='2026-06-01'",
                    (company,),
                ).fetchone()
            ),
        )

    def test_success_acknowledges_the_requested_revision_and_keeps_future_work_pending(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        before = self.queue_state(inputs.company)
        self.assertGreater(before[0], before[1])
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        after = self.queue_state(inputs.company)
        self.assertEqual(after[:2], (before[0], before[0]))
        self.assertEqual(after[2], 0)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.payout_report_refresh_state "
                "where company_id=%s and month='2026-07-01' "
                "and requested_revision>completed_revision",
                (inputs.company,),
            ).fetchone(),
            (1,),
        )
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))

    def test_failed_work_backs_off_and_new_input_restarts_it_immediately(self) -> None:
        inputs = prepare_payout(self)
        self.fee(inputs.sku_identity, [])
        self.assertEqual(refresh_payout_reports(self), (1, 0, 0, 1))
        failed = self.queue_state(inputs.company)
        self.assertGreater(failed[0], failed[1])
        self.assertEqual(failed[2:], (1, True))
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
        self.connection.execute(
            "update private.payout_report_refresh_state set next_attempt_at='-infinity' "
            "where company_id=%s and month='2026-06-01'",
            (inputs.company,),
        )
        self.assertEqual(refresh_payout_reports(self), (1, 0, 0, 1))
        self.assertEqual(self.queue_state(inputs.company)[2:], (2, True))
        self.assertEqual(
            self.connection.execute(
                "select next_attempt_at-last_attempt_at between interval '9 minutes 59 seconds' "
                "and interval '10 minutes 1 second' from private.payout_report_refresh_state "
                "where company_id=%s and month='2026-06-01'",
                (inputs.company,),
            ).fetchone(),
            (True,),
        )
        self.fee(inputs.sku_identity, [("2026-01-01", None, "7")])
        requested = self.queue_state(inputs.company)
        self.assertGreater(requested[0], failed[0])
        self.assertEqual(requested[2:], (0, False))
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(self.queue_state(inputs.company)[0], self.queue_state(inputs.company)[1])

    def test_repeated_failures_cap_backoff_at_six_hours(self) -> None:
        inputs = prepare_payout(self)
        self.fee(inputs.sku_identity, [])
        self.connection.execute(
            "update private.payout_report_refresh_state set failure_count=30 "
            "where company_id=%s and month='2026-06-01'",
            (inputs.company,),
        )
        self.assertEqual(refresh_payout_reports(self), (1, 0, 0, 1))
        self.assertEqual(
            self.connection.execute(
                "select next_attempt_at-last_attempt_at between "
                "interval '5 hours 59 minutes 59 seconds' "
                "and interval '6 hours 1 second' from private.payout_report_refresh_state "
                "where company_id=%s and month='2026-06-01'",
                (inputs.company,),
            ).fetchone(),
            (True,),
        )

    def test_maturity_advances_despite_an_older_month_in_backoff(self) -> None:
        inputs = prepare_payout(self)
        self.fee(inputs.sku_identity, [])
        self.assertEqual(refresh_payout_reports(self), (1, 0, 0, 1))
        self.set_mature_cutoff_date(date(2026, 8, 1))
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select start_date from public.company_payout_reports where company_id=%s",
                (inputs.company,),
            ).fetchall(),
            [(date(2026, 7, 1),)],
        )
        self.assertEqual(self.queue_state(inputs.company)[2:], (1, True))

    def test_idle_worker_does_not_read_financial_history_or_payout_rows(self) -> None:
        prepare_payout(self)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.connection.commit()
        counters = (
            "select schemaname,relname,seq_scan,seq_tup_read,idx_scan,idx_tup_fetch "
            "from pg_stat_xact_user_tables where relname in "
            "('settlement_transactions','settlement_preprocess_versions','settlements',"
            "'data_kiosk_transactions','data_kiosk_preprocess_versions','data_kiosk_days',"
            "'company_payout_reports','company_payout_report_components',"
            "'payout_report_settlement_versions','payout_report_data_kiosk_versions',"
            "'payout_report_terms_versions','payout_report_reconciliation') "
            "order by schemaname,relname"
        )
        before = self.connection.execute(counters).fetchall()
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
        self.assertEqual(self.connection.execute(counters).fetchall(), before)

    def test_idle_worker_skips_thousands_of_clean_company_months(self) -> None:
        inputs = prepare_payout(self)
        refresh_payout_reports(self)
        self.connection.execute(
            "insert into private.payout_report_refresh_state "
            "(company_id,month,requested_revision,completed_revision) "
            "select %s,m::date,1,1 from generate_series(date '1800-01-01',date '2026-05-01',"
            "interval '1 month') m on conflict do nothing",
            (inputs.company,),
        )
        self.connection.execute("analyze private.payout_report_refresh_state")
        self.connection.commit()
        counters = (
            "select seq_scan,seq_tup_read from pg_stat_xact_user_tables "
            "where schemaname='private' and relname='payout_report_refresh_state'"
        )
        before = self.connection.execute(counters).fetchone()
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
        self.assertEqual(self.connection.execute(counters).fetchone(), before)
        self.connection.execute(
            "update private.payout_report_refresh_state set requested_revision=2 "
            "where company_id=%s and month='2000-01-01'",
            (inputs.company,),
        )
        self.connection.commit()
        before = self.connection.execute(counters).fetchone()
        self.assertEqual(refresh_payout_reports(self, 1), (1, 1, 0, 0))
        self.assertEqual(self.connection.execute(counters).fetchone(), before)

    def test_multiple_requests_coalesce_into_one_latest_snapshot(self) -> None:
        inputs = prepare_payout(self)
        refresh_payout_reports(self)
        self.fee(inputs.sku_identity, [("2026-01-01", None, "8")])
        self.fee(inputs.sku_identity, [("2026-01-01", None, "9")])
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(self.queue_state(inputs.company)[0], self.queue_state(inputs.company)[1])
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (2,),
        )

    def test_new_changes_do_not_jump_a_completed_company_ahead_of_older_pending_work(self) -> None:
        inputs = prepare_payout(self)
        other, _ = self.owner("OTHER")
        self.assertEqual(refresh_payout_reports(self, 1), (1, 1, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select company_id::text from public.company_payout_reports"
            ).fetchall(),
            [(inputs.company,)],
        )
        self.settlement(
            [self.transaction("200")],
            acquisition_id=inputs.acquisition,
            expected=inputs.settlement_version,
        )
        self.assertEqual(refresh_payout_reports(self, 1), (1, 1, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports where company_id=%s",
                (other,),
            ).fetchone(),
            (1,),
        )
        remaining = self.queue_state(inputs.company)
        self.assertGreater(remaining[0], remaining[1])
        self.assertEqual(refresh_payout_reports(self, 1), (1, 1, 0, 0))
