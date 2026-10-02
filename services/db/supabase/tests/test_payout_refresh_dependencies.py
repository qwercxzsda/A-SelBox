"""Queue invalidation follows complete payout dependencies, including exclusions."""

from datetime import date
from decimal import Decimal

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import prepare_payout, refresh_payout_reports
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class PayoutRefreshDependencyTests(SourceModelFixture):
    def requested_revision(self, company: str) -> int:
        return int(
            require_row(
                self.connection.execute(
                    "select requested_revision from private.payout_report_refresh_state "
                    "where company_id=%s and month='2026-06-01'",
                    (company,),
                ).fetchone()
            )[0]
        )

    def test_fee_change_refreshes_reports_that_pin_another_companys_exclusion_terms(self) -> None:
        inputs = prepare_payout(self)
        other, other_identity = self.owner("OTHER")
        unrelated, _ = self.owner("UNRELATED")
        self.fee(other_identity, [("2026-01-01", None, "5")])
        self.settlement(
            [self.transaction("100"), self.transaction("40", 4, sku="OTHER")],
            acquisition_id=inputs.acquisition,
            expected=inputs.settlement_version,
        )
        self.assertEqual(refresh_payout_reports(self), (3, 3, 0, 0))
        before = {
            company: self.requested_revision(company)
            for company in (inputs.company, other, unrelated)
        }
        self.fee(other_identity, [("2026-01-01", None, "8")])
        for company in (inputs.company, other):
            self.assertGreater(self.requested_revision(company), before[company])
        self.assertEqual(self.requested_revision(unrelated), before[unrelated])
        self.assertEqual(refresh_payout_reports(self), (2, 2, 0, 0))

    def test_replacing_source_rows_with_empty_version_refreshes_the_old_amount(self) -> None:
        inputs = prepare_payout(self)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.kiosk(2, [], expected=inputs.kiosk_version)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select source_amount,company_amount from public.company_payout_reports "
                "where company_id=%s order by created_at desc,id desc limit 1",
                (inputs.company,),
            ).fetchone(),
            (Decimal(100), Decimal(95)),
        )

    def test_registering_sku_refreshes_pinned_source_that_previously_had_no_terms_manifest(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        self.settlement(
            [
                self.transaction("100"),
                self.transaction("-3", 4, sku="UNREGISTERED", category="SELBOX", kind="NewFee")
                | {"family": None},
            ],
            acquisition_id=inputs.acquisition,
            expected=inputs.settlement_version,
        )
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        before = self.requested_revision(inputs.company)
        self.owner("UNREGISTERED")
        self.assertGreater(self.requested_revision(inputs.company), before)
        # This account-only row leaves the original amount and exact-input
        # signature unchanged, but its pinned source must still be checked.
        self.assertEqual(refresh_payout_reports(self), (2, 1, 1, 0))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports where company_id=%s",
                (inputs.company,),
            ).fetchone(),
            (1,),
        )

    def test_new_marketplace_requires_older_report_coverage_even_when_new_day_is_future(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        before = self.requested_revision(inputs.company)
        acquisition = self.kiosk_acquisition(1, start="2026-07-01")
        self.call(
            "publish_data_kiosk_preprocess",
            {
                "id": new_id(),
                "acquisition_id": acquisition,
                "preprocess_version": "v0",
                "dataset_key": "economics",
                "days": [
                    {
                        "id": new_id(),
                        "marketplace_name": "Amazon.ca",
                        "activity_date": "2026-07-01",
                        "expected_current_version_id": None,
                        "content_sha256": "d" * 64,
                        "transactions": [],
                    }
                ],
            },
        )
        self.assertGreater(self.requested_revision(inputs.company), before)
        self.assertEqual(refresh_payout_reports(self), (1, 0, 0, 1))
        self.assertIn(
            "Data Kiosk",
            str(
                require_row(
                    self.connection.execute(
                        "select last_error_message from private.payout_report_refresh_state "
                        "where company_id=%s and month='2026-06-01'",
                        (inputs.company,),
                    ).fetchone()
                )[0]
            ),
        )

    def test_historical_source_import_discovers_earlier_months_for_existing_companies(self) -> None:
        inputs = prepare_payout(self)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.kiosk(1, [], activity_date="2026-04-01")
        self.assertEqual(refresh_payout_reports(self), (2, 2, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select start_date from public.company_payout_reports "
                "where company_id=%s order by start_date",
                (inputs.company,),
            ).fetchall(),
            [(date(2026, 4, 1),), (date(2026, 5, 1),), (date(2026, 6, 1),)],
        )

    def test_noncurrent_reprocessing_of_known_sku_does_not_wake_completed_month(self) -> None:
        inputs = prepare_payout(self)
        _, current = self.kiosk(3, [self.component("-12")], expected=inputs.kiosk_version)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        before = self.requested_revision(inputs.company)
        self.kiosk(2, [self.component("-11")], expected=current)
        self.assertEqual(self.requested_revision(inputs.company), before)
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))

    def test_noncurrent_first_sku_relationship_refreshes_historical_empty_reports(self) -> None:
        inputs = prepare_payout(self)
        empty_company, _ = self.owner("HISTORICAL")
        self.seller = "other-seller"
        _, current = self.kiosk(3, [], activity_date="2026-07-15")
        self.assertEqual(refresh_payout_reports(self), (2, 2, 0, 0))
        before = self.requested_revision(empty_company)
        self.kiosk(
            2,
            [self.component("-11", sku="HISTORICAL")],
            expected=current,
            activity_date="2026-07-15",
        )
        self.assertGreater(self.requested_revision(empty_company), before)
        self.assertEqual(refresh_payout_reports(self), (2, 0, 2, 0))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports where company_id=%s",
                (inputs.company,),
            ).fetchone(),
            (1,),
        )

    def test_pruning_final_historical_sku_relationship_preserves_pinned_source_scope(
        self,
    ) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        company, _ = self.owner()
        _, current = self.kiosk(1, [self.component("-10")])
        for observation in (2, 3, 4):
            _, current = self.kiosk(observation, [], expected=current)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        before = self.requested_revision(company)
        self.assertEqual(
            self.connection.execute("select private.prune_data_kiosk_preprocess()").fetchone(),
            (1,),
        )
        self.assertGreater(self.requested_revision(company), before)
        self.assertEqual(refresh_payout_reports(self), (1, 0, 1, 0))
