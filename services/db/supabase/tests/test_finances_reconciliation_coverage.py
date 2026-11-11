"""Partial-day observations cannot borrow payout proof for changed Finance versions."""

from dataclasses import replace
from datetime import datetime
from typing import cast

import psycopg

from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.payout_fixtures import (
    payout_snapshot,
    prepare_payout,
    publish_payout,
)
from services.db.supabase.tests.source_finances import finance_transaction
from services.db.supabase.tests.source_fixtures import SourceModelFixture
from services.sync.src.database.finances import publish_finances
from services.sync.src.finances.models import PreparedFinances


class FinancesReconciliationCoverageTests(SourceModelFixture):
    def partial_observation(self, rows: list[dict[str, object]], day: str = "15") -> str:
        """Capture part of a historical local day without claiming daily reconciliation."""
        acquisition_id = self.acquisition(start=f"2026-06-{day}", end=f"2026-06-{day}")
        original = self.finances_acquisitions[acquisition_id]
        after = datetime.fromisoformat(f"2026-06-{day}T09:00:00+00:00")
        before = datetime.fromisoformat(f"2026-06-{day}T20:00:00+00:00")
        page = replace(
            original.documents[0],
            request_parameters={
                "postedAfter": after.isoformat(),
                "postedBefore": before.isoformat(),
            },
        )
        capture = replace(
            original,
            posted_after=after,
            posted_before=before,
            reconciliation_start_date=None,
            reconciliation_end_date=None,
            documents=(page,),
            api_metadata={**original.api_metadata, "summary_available": False},
        )
        transactions = tuple(
            finance_transaction(row, capture, index) for index, row in enumerate(rows, 1)
        )
        return publish_finances(
            TransactionDatabase(self.connection),
            capture,
            PreparedFinances(transactions, ()),
            preprocess_version="v0",
        )

    def covered_days(self) -> list[str]:
        return [
            str(row[0])
            for row in self.connection.execute(
                "select activity_date from private.current_payout_source_days("
                "%s::text[],'2026-06-01','2026-06-30','Amazon.com') "
                "where source='FINANCES' order by activity_date",
                ([self.seller],),
            ).fetchall()
        ]

    def test_unchanged_partial_observation_reuses_reconciled_version_proof(self) -> None:
        inputs = prepare_payout(self)
        report = publish_payout(self, inputs)
        partial_batch = self.partial_observation([self.transaction("100")])
        self.assertEqual(len(self.covered_days()), 30)
        self.assertEqual(publish_payout(self, inputs), report)
        self.assertEqual(
            self.connection.execute(
                "select private.finances_batch_matches_current(%s,'2026-06-15','2026-06-15')",
                (partial_batch,),
            ).fetchone(),
            (False,),
        )
        administrator = self.administrator()
        self.assertEqual(
            self.as_user(
                administrator,
                "select posted_after is not null,posted_before is not null,"
                "reconciliation_start_date,reconciliation_end_date "
                "from public.finances_preprocess_results where id=%s",
                (partial_batch,),
            ),
            [(True, True, None, None)],
        )
        self.connection.execute("set constraints all immediate")

    def test_changed_partial_observation_blocks_only_its_unreconciled_day(self) -> None:
        inputs = prepare_payout(self)
        report = publish_payout(self, inputs)
        frozen = payout_snapshot(self, report)
        self.partial_observation([self.transaction("120")])
        self.assertEqual(len(self.covered_days()), 29)
        self.assertNotIn("2026-06-15", self.covered_days())
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "source coverage"),
            self.connection.transaction(),
        ):
            publish_payout(self, inputs)
        self.assertEqual(payout_snapshot(self, report), frozen)
        reconciled = self.acquisition(start="2026-06-15", end="2026-06-15")
        self.finances([self.transaction("120")], acquisition_id=reconciled)
        self.assertEqual(len(self.covered_days()), 30)
        self.assertNotEqual(publish_payout(self, inputs), report)
        self.connection.execute("set constraints all immediate")

    def test_new_partial_day_transaction_cannot_reuse_old_empty_day_proof(self) -> None:
        inputs = prepare_payout(self)
        original = publish_payout(self, inputs)
        self.partial_observation([self.transaction("50", 4, activity_date="2026-06-16")], "16")
        days = self.covered_days()
        self.assertEqual(len(days), 29)
        self.assertIn("2026-06-15", days)
        self.assertNotIn("2026-06-16", days)
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "source coverage"),
            self.connection.transaction(),
        ):
            publish_payout(self, inputs)
        reconciled = self.acquisition(start="2026-06-16", end="2026-06-16")
        self.finances(
            [self.transaction("50", 4, activity_date="2026-06-16")],
            acquisition_id=reconciled,
        )
        self.assertEqual(len(self.covered_days()), 30)
        self.assertNotEqual(publish_payout(self, inputs), original)
        self.connection.execute("set constraints all immediate")

    def test_empty_partial_capture_does_not_establish_source_coverage(self) -> None:
        self.partial_observation([])
        self.assertEqual(self.covered_days(), [])
        administrator = self.administrator()
        result = cast(
            dict[str, object],
            self.as_user(
                administrator,
                "select public.current_source_totals('2026-06-01','2026-06-30','Amazon.com')",
            )[0][0],
        )
        self.assertEqual(result["coverage"], [])
        self.connection.execute("set constraints all immediate")
