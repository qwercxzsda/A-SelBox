"""Successful batch membership replaces daily versions and persisted Summary checks."""

from dataclasses import replace

import psycopg

from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture
from services.sync.src.database.finances import publish_finances
from services.sync.src.finances.models import FinancesSummary, PreparedFinances
from services.sync.src.numeric import Numeric


class PayoutFinancesBatchTests(SourceModelFixture):
    def selected_batches(self) -> list[str]:
        row = require_row(
            self.connection.execute(
                "select private.payout_finances_batch_ids(%s::text[],'2026-06-01','2026-06-30')",
                ([self.seller],),
            ).fetchone()
        )
        return [str(value) for value in row[0]]

    def test_repeated_observation_reuses_payload_and_selects_new_successful_batch(self) -> None:
        first, revision = self.finances([self.transaction("100")])
        second, repeated_revision = self.finances([self.transaction("100")])
        self.assertNotEqual(first, second)
        self.assertEqual(revision, repeated_revision)
        self.assertEqual(self.selected_batches(), [second])
        self.assertEqual(
            self.connection.execute(
                "select (select count(*) from private.finances_transaction_versions),"
                "(select count(*) from private.finances_transaction_components),"
                "(select count(*) from private.finances_preprocess_batch_transactions)"
            ).fetchone(),
            (1, 1, 2),
        )

    def test_changed_partial_observation_requires_full_period_revalidation(self) -> None:
        self.finances([self.transaction("100")])
        partial_capture = self.acquisition(start="2026-06-15", end="2026-06-15")
        self.finances([self.transaction("120")], acquisition_id=partial_capture)
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "coverage"),
            self.connection.transaction(),
        ):
            self.selected_batches()
        complete_batch, _ = self.finances([self.transaction("120")])
        self.assertEqual(self.selected_batches(), [complete_batch])

    def test_empty_successful_batch_still_supplies_complete_period_coverage(self) -> None:
        batch, revision = self.finances([])
        self.assertIsNone(revision)
        self.assertEqual(self.selected_batches(), [batch])
        self.assertEqual(
            self.connection.execute(
                "select transaction_count,component_count from private.finances_preprocess_batches "
                "where id=%s",
                (batch,),
            ).fetchone(),
            (0, 0),
        )

    def test_one_empty_regional_batch_covers_multiple_markets_once(self) -> None:
        captured = self.finances_acquisitions[self.acquisition()]
        marketplaces = (
            ("ATVPDKIKX0DER", "Amazon.com"),
            ("A2EUQ1WTGCTBG2", "Amazon.ca"),
        )
        acquisition = replace(
            captured,
            marketplace_ids=tuple(identifier for identifier, _ in marketplaces),
            api_metadata={
                **captured.api_metadata,
                "coverage_marketplaces": [
                    {
                        "marketplace_id": identifier,
                        "marketplace_name": name,
                        "time_zone": "America/Los_Angeles",
                    }
                    for identifier, name in marketplaces
                ],
            },
        )
        summaries = tuple(
            FinancesSummary(
                identifier,
                name,
                "STANDARD_ORDERS",
                "USD",
                acquisition.query_start_date,
                acquisition.query_end_date,
                Numeric(0),
                1,
                index,
            )
            for index, (identifier, name) in enumerate(marketplaces, 1)
        )
        batch = publish_finances(
            TransactionDatabase(self.connection),
            acquisition,
            PreparedFinances((), summaries),
            preprocess_version="v0",
        )
        self.assertEqual(self.selected_batches(), [batch])

    def test_partial_only_capture_cannot_disappear_from_required_month_scope(self) -> None:
        acquisition = self.acquisition(start="2026-06-15", end="2026-06-15")
        self.finances([], acquisition_id=acquisition)
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "coverage"),
            self.connection.transaction(),
        ):
            self.selected_batches()

    def test_frozen_batch_validation_does_not_follow_later_current_pointers(self) -> None:
        old_batch, _ = self.finances([self.transaction("100")])
        current_batch, _ = self.finances([self.transaction("200")])
        self.assertEqual(self.selected_batches(), [current_batch])
        self.assertEqual(
            self.connection.execute(
                "select private.finances_batch_matches_current(%s,'2026-06-01','2026-06-30')",
                (old_batch,),
            ).fetchone(),
            (False,),
        )
        self.connection.execute(
            "select private.assert_payout_sources('2026-06-01','2026-06-30','economics',"
            "%s::uuid[],'{}'::uuid[],false,%s::text[])",
            ([old_batch], [self.seller]),
        )
