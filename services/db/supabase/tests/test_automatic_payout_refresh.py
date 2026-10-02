"""Pending work discovers mature months and eventually refreshes immutable payouts."""

from datetime import date
from decimal import Decimal

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    payout_snapshot,
    prepare_payout,
    refresh_payout_reports,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class AutomaticPayoutRefreshTests(SourceModelFixture):
    def state(self, company: str) -> tuple[object, ...]:
        return require_row(
            self.connection.execute(
                "select last_attempt_at,last_success_at,last_error_sqlstate,last_error_message "
                "from private.payout_report_refresh_state "
                "where company_id=%s and month='2026-06-01'",
                (company,),
            ).fetchone()
        )

    def latest_report(self, company: str) -> str:
        return str(
            require_row(
                self.connection.execute(
                    "select id::text from public.company_payout_reports where company_id=%s "
                    "order by created_at desc,id desc limit 1",
                    (company,),
                ).fetchone()
            )[0]
        )

    def test_no_financial_history_does_not_invent_months(self) -> None:
        self.owner()
        self.acquisition()
        self.kiosk_acquisition(1)
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.payout_report_refresh_state"
            ).fetchone(),
            (0,),
        )

    def test_maturity_alone_discovers_a_month_without_another_source_write(self) -> None:
        inputs = prepare_payout(self)
        self.set_mature_cutoff_date(date(2026, 6, 30))
        self.connection.commit()
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
        # Advance only the fixture clock: neither a source publication nor a
        # browser action is needed when the whole month becomes mature.
        self.set_mature_cutoff_date(date(2026, 7, 1))
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select company_id::text,start_date,end_date from public.company_payout_reports"
            ).fetchone(),
            (inputs.company, date(2026, 6, 1), date(2026, 6, 30)),
        )
        self.connection.commit()

    def test_source_and_fee_changes_refresh_and_unchanged_inputs_are_skipped(self) -> None:
        inputs = prepare_payout(self)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        original = self.latest_report(inputs.company)
        snapshot = payout_snapshot(self, original)
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
        self.settlement(
            [self.transaction("200")],
            acquisition_id=inputs.acquisition,
            expected=inputs.settlement_version,
        )
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.kiosk(2, [self.component("-20")], expected=inputs.kiosk_version)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.fee(inputs.sku_identity, [("2026-01-01", None, "10")])
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount from public.company_payout_reports "
                "where id=%s",
                (self.latest_report(inputs.company),),
            ).fetchone(),
            (Decimal(180), Decimal(-20), Decimal(160)),
        )
        self.assertEqual(payout_snapshot(self, original), snapshot)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (4,),
        )
        self.connection.commit()

    def test_every_company_gets_each_known_mature_month_including_inactive_months(self) -> None:
        inputs = prepare_payout(self)
        other, _ = self.owner("INACTIVE")
        self.set_mature_cutoff_date(date(2026, 8, 1))
        self.assertEqual(refresh_payout_reports(self), (4, 4, 0, 0))
        self.assertCountEqual(
            self.connection.execute(
                "select company_id::text,start_date,company_amount "
                "from public.company_payout_reports"
            ).fetchall(),
            [
                (inputs.company, date(2026, 6, 1), Decimal(85)),
                (inputs.company, date(2026, 7, 1), Decimal(0)),
                (other, date(2026, 6, 1), Decimal(0)),
                (other, date(2026, 7, 1), Decimal(0)),
            ],
        )
        later, _ = self.owner("NEW-COMPANY")
        self.assertEqual(refresh_payout_reports(self), (2, 2, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports where company_id=%s",
                (later,),
            ).fetchone(),
            (2,),
        )

    def test_missing_coverage_is_recorded_then_recovers_without_blocking_other_companies(
        self,
    ) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        company, identity = self.owner()
        self.fee(identity, [("2026-01-01", None, "5")])
        self.settlement([self.transaction("100")])
        self.kiosk(1, [self.component("-10")])
        other, _ = self.owner("OTHER")
        self.assertEqual(refresh_payout_reports(self), (2, 1, 0, 1))
        failed = self.state(company)
        self.assertIsNotNone(failed[0])
        self.assertIsNone(failed[1])
        self.assertEqual(failed[2], "23514")
        self.assertIn("Data Kiosk", str(failed[3]))
        self.assertIsNotNone(self.state(other)[1])
        self.assertEqual(
            self.connection.execute(
                "select company_id::text from public.company_payout_reports"
            ).fetchall(),
            [(other,)],
        )
        self.connection.commit()
        fill_payout_kiosk_month(self)
        self.assertEqual(refresh_payout_reports(self), (2, 1, 1, 0))
        recovered = self.state(company)
        self.assertIsNotNone(recovered[1])
        self.assertEqual(recovered[2:], (None, None))
        self.connection.commit()

    def test_failed_revision_retains_last_success_and_recovers_after_fee_repair(self) -> None:
        inputs = prepare_payout(self)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        before = self.state(inputs.company)
        report = self.latest_report(inputs.company)
        snapshot = payout_snapshot(self, report)
        self.fee(inputs.sku_identity, [])
        self.assertEqual(refresh_payout_reports(self), (1, 0, 0, 1))
        failed = self.state(inputs.company)
        self.assertEqual(failed[1], before[1])
        self.assertEqual(failed[2], "23514")
        self.assertEqual(payout_snapshot(self, report), snapshot)
        self.fee(inputs.sku_identity, [("2026-01-01", None, "8")])
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(self.state(inputs.company)[2:], (None, None))

    def test_transferred_ownership_refreshes_old_company_to_zero(self) -> None:
        inputs = prepare_payout(self)
        other, _ = self.owner("OTHER")
        self.assertEqual(refresh_payout_reports(self), (2, 2, 0, 0))
        previous = self.latest_report(inputs.company)
        snapshot = payout_snapshot(self, previous)
        current = require_row(
            self.connection.execute(
                "select current_terms_version_id::text from public.skus where id=%s",
                (inputs.sku_identity,),
            ).fetchone()
        )[0]
        self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": inputs.sku_identity,
                "sku": "SKU",
                "company_id": other,
                "expected_current_version_id": current,
                "change_reason": "Transfer ownership",
                "periods": [
                    {
                        "id": new_id(),
                        "marketplace_name": "Amazon.com",
                        "valid_from": "2026-01-01",
                        "valid_to": None,
                        "fee_rate_percent": "5",
                    }
                ],
            },
        )
        self.assertEqual(refresh_payout_reports(self), (2, 2, 0, 0))
        for company, amount in ((inputs.company, Decimal(0)), (other, Decimal(85))):
            self.assertEqual(
                self.connection.execute(
                    "select company_amount from public.company_payout_reports where id=%s",
                    (self.latest_report(company),),
                ).fetchone(),
                (amount,),
            )
        self.assertEqual(payout_snapshot(self, previous), snapshot)
        self.connection.commit()

    def test_bounded_sweeps_visit_unattempted_work_before_retrying_failures(self) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        failing, _ = self.owner()
        self.settlement([self.transaction("100")])
        self.owner("OTHER-A")
        self.owner("OTHER-B")
        self.assertEqual(refresh_payout_reports(self, 1), (1, 0, 0, 1))
        self.assertIsNotNone(self.state(failing)[0])
        self.assertEqual(refresh_payout_reports(self, 1), (1, 1, 0, 0))
        self.assertEqual(refresh_payout_reports(self, 1), (1, 1, 0, 0))
        self.assertEqual(refresh_payout_reports(self, 1), (0, 0, 0, 0))
        self.connection.execute(
            "update private.payout_report_refresh_state set next_attempt_at='-infinity' "
            "where company_id=%s and month='2026-06-01'",
            (failing,),
        )
        self.assertEqual(refresh_payout_reports(self, 1), (1, 0, 0, 1))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.payout_report_refresh_state "
                "where last_attempt_at is not null"
            ).fetchone(),
            (3,),
        )

    def test_invalid_batch_limits_are_rejected(self) -> None:
        for limit in (None, 0, -1, 101):
            with (
                self.subTest(limit=limit),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "select * from private.refresh_company_payout_reports(%s)", (limit,)
                )
