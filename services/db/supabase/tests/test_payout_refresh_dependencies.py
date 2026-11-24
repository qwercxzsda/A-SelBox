"""Queue invalidation follows complete payout dependencies, including exclusions."""

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import (
    prepare_payout,
    refresh_payout_reports,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture


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
        self.finances(
            [self.transaction("100"), self.transaction("40", 4, sku="OTHER")],
            acquisition_id=inputs.acquisition,
        )
        self.assertEqual(refresh_payout_reports(self), (3, 3, 0, 0))
        before = {
            company: self.requested_revision(company)
            for company in (inputs.company, other, unrelated)
        }
        self.fee(other_identity, [("2026-01-01", None, "8")])
        for company in (inputs.company, other, unrelated):
            self.assertGreater(self.requested_revision(company), before[company])
        self.assertEqual(refresh_payout_reports(self), (3, 3, 0, 0))

    def test_registering_sku_refreshes_pinned_source_that_previously_had_no_terms_manifest(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        self.finances(
            [
                self.transaction("100"),
                self.transaction("-3", 4, sku="UNREGISTERED", kind="Adjustment"),
            ],
            acquisition_id=inputs.acquisition,
        )
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        before = self.requested_revision(inputs.company)
        self.owner("UNREGISTERED")
        self.assertGreater(self.requested_revision(inputs.company), before)
        self.assertEqual(refresh_payout_reports(self), (2, 2, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports where company_id=%s",
                (inputs.company,),
            ).fetchone(),
            (2,),
        )
