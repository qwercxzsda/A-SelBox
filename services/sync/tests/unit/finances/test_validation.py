"""Complete-candidate checks are independent of database publication side effects."""

import unittest
from collections.abc import Sequence
from dataclasses import asdict, replace
from datetime import UTC, date, datetime, timedelta
from uuid import uuid7

from services.sync.src.allocation import AllocationCategory
from services.sync.src.finances.acquisition_models import FinancesAcquisition
from services.sync.src.finances.preprocess import prepare_finances_acquisition
from services.sync.src.finances.validation import revision_digest, validate_finances_candidate
from services.sync.src.numeric import Numeric
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.finances import finances_acquisition, native_transaction


class CandidateValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = MemoryArchiveStorage()
        self.acquisition = finances_acquisition(
            self.storage, [native_transaction()], summary_amount="100"
        )
        self.prepared = prepare_finances_acquisition(self.acquisition, self.storage)

    def accepted(self) -> dict[str, object]:
        return {
            **asdict(self.prepared.transactions[0]),
            "total_amount": self.prepared.transactions[0].total_amount.value,
            "capture_started_at": self.acquisition.capture_started_at - timedelta(seconds=1),
            "acquisition_id": uuid7(),
        }

    def rolling(
        self, rows: Sequence[object], *, after: datetime, summary_amount: str | None = None
    ) -> FinancesAcquisition:
        acquisition = finances_acquisition(self.storage, rows, summary_amount=summary_amount)
        captured = datetime(2026, 8, 3, 12, tzinfo=UTC)
        has_summary = summary_amount is not None
        return replace(
            acquisition,
            posted_after=after,
            posted_before=None,
            capture_started_at=captured,
            downloaded_at=captured,
            reconciliation_start_date=date(2026, 8, 1) if has_summary else None,
            reconciliation_end_date=date(2026, 8, 2) if has_summary else None,
            documents=tuple(
                replace(
                    page,
                    requested_at=captured,
                    received_at=captured,
                    request_parameters={"postedAfter": after.isoformat()}
                    if page.operation == "transactions"
                    else page.request_parameters,
                )
                for page in acquisition.documents
            ),
        )

    def test_partial_first_and_current_days_are_imported_but_not_in_summary_equation(self) -> None:
        rows = [
            native_transaction("first", posted="2026-07-31T20:00:00Z", amount="25"),
            native_transaction("whole", posted="2026-08-01T12:00:00Z", amount="100"),
            native_transaction("tail", posted="2026-08-03T11:59:30Z", amount="30"),
        ]
        acquisition = self.rolling(
            rows,
            after=datetime(2026, 7, 31, 17, tzinfo=UTC),
            summary_amount="100",
        )
        prepared = prepare_finances_acquisition(acquisition, self.storage)
        result = validate_finances_candidate(acquisition, prepared, [], [])
        self.assertEqual(len(result.transactions), 3)
        self.assertEqual(
            sum((row.total_amount for row in result.transactions), Numeric(0)), Numeric(155)
        )
        self.assertEqual(result.summaries[0].net_proceeds, Numeric(100))
        invalid = replace(
            prepared, summaries=(replace(prepared.summaries[0], net_proceeds=Numeric(155)),)
        )
        with self.assertRaisesRegex(ValueError, "Summary does not match"):
            validate_finances_candidate(acquisition, invalid, [], [])

    def test_partial_only_capture_imports_without_certifying_any_complete_day(self) -> None:
        acquisition = self.rolling(
            [native_transaction("tail", posted="2026-08-03T11:00:00Z")],
            after=datetime(2026, 8, 3, 10, tzinfo=UTC),
        )
        prepared = prepare_finances_acquisition(acquisition, self.storage)
        self.assertEqual(validate_finances_candidate(acquisition, prepared, [], []), prepared)
        self.assertIsNone(acquisition.reconciliation_start_date)
        self.assertIsNone(acquisition.reconciliation_end_date)
        self.assertEqual(prepared.summaries, ())

    def test_missing_identity_scope_uses_conservative_utc_upper_bound_not_local_date(self) -> None:
        acquisition = self.rolling(
            [native_transaction("tail", posted="2026-08-03T11:00:00Z")],
            after=datetime(2026, 8, 3, 10, tzinfo=UTC),
        )
        prepared = prepare_finances_acquisition(acquisition, self.storage)
        outside = self.accepted()
        outside.update(
            native_transaction_id="unobserved",
            posted_date=date(2026, 8, 3),
            posted_at=datetime(2026, 8, 3, 11, 59, tzinfo=UTC),
            capture_started_at=acquisition.capture_started_at - timedelta(seconds=1),
        )
        validate_finances_candidate(acquisition, prepared, [outside], [])
        outside["posted_at"] = datetime(2026, 8, 3, 11, 57, tzinfo=UTC)
        with self.assertRaisesRegex(ValueError, "missing from complete coverage"):
            validate_finances_candidate(acquisition, prepared, [outside], [])

    def test_equal_numeric_values_and_changed_archive_locations_reuse_revision_identity(
        self,
    ) -> None:
        original = self.prepared.transactions[0]
        changed = replace(
            original,
            source_page_number=5,
            source_record_number=17,
            total_amount=Numeric("100.00"),
            components=(
                replace(
                    original.components[0], amount=Numeric("100.0"), fee_base=Numeric("100.000")
                ),
            ),
        )
        self.assertEqual(revision_digest(original), revision_digest(changed))
        self.assertNotEqual(
            revision_digest(original),
            revision_digest(replace(original, transaction_status="RELEASED")),
        )

    def test_missing_previously_accepted_identity_fails_even_when_new_total_matches(self) -> None:
        empty = replace(
            self.prepared,
            transactions=(),
            summaries=(replace(self.prepared.summaries[0], net_proceeds=Numeric(0)),),
        )
        with self.assertRaisesRegex(ValueError, "missing from complete coverage"):
            validate_finances_candidate(self.acquisition, empty, [self.accepted()], [])

    def test_newer_successful_empty_coverage_still_blocks_an_older_capture(self) -> None:
        with self.assertRaisesRegex(ValueError, "older Finances capture"):
            validate_finances_candidate(
                self.acquisition,
                self.prepared,
                [],
                [
                    {
                        "id": uuid7(),
                        "capture_started_at": self.acquisition.capture_started_at
                        + timedelta(seconds=1),
                    }
                ],
            )

    def test_matching_empty_capture_is_valid_without_invented_transaction(self) -> None:
        empty = replace(
            self.prepared,
            transactions=(),
            summaries=(replace(self.prepared.summaries[0], net_proceeds=Numeric(0)),),
        )
        self.assertEqual(
            validate_finances_candidate(self.acquisition, empty, [], []).transactions, ()
        )

    def test_missing_or_unmatched_independent_control_cannot_succeed(self) -> None:
        for summaries in (
            (),
            (replace(self.prepared.summaries[0], net_proceeds=Numeric(99)),),
            (
                *self.prepared.summaries,
                replace(
                    self.prepared.summaries[0],
                    account_type="INVOICED_ORDERS",
                    net_proceeds=Numeric(1),
                ),
            ),
        ):
            with self.subTest(summaries=summaries), self.assertRaisesRegex(ValueError, "Summary"):
                validate_finances_candidate(
                    self.acquisition, replace(self.prepared, summaries=summaries), [], []
                )

    def test_partition_must_match_parent_before_publication(self) -> None:
        transaction = self.prepared.transactions[0]
        invalid = replace(
            transaction,
            components=(
                replace(transaction.components[0], amount=Numeric(99), fee_base=Numeric(99)),
            ),
        )
        with self.assertRaisesRegex(ValueError, "partition"):
            validate_finances_candidate(
                self.acquisition, replace(self.prepared, transactions=(invalid,)), [], []
            )

    def test_outside_scope_current_links_are_used_to_validate_the_full_candidate(self) -> None:
        original = self.accepted()
        original.update(
            native_transaction_id="original",
            release_transaction_id="A",
            posted_date=self.acquisition.posted_after.date() - timedelta(days=1),
            posted_at=self.acquisition.posted_after - timedelta(days=1),
        )
        transaction = replace(self.prepared.transactions[0], transaction_status="RELEASED")
        candidate = replace(
            self.prepared,
            transactions=(transaction,),
            summaries=(replace(self.prepared.summaries[0], net_proceeds=Numeric(0)),),
        )
        result = validate_finances_candidate(self.acquisition, candidate, [original], [])
        self.assertFalse(result.transactions[0].activity_eligible)

    def test_link_change_cannot_silently_rewrite_an_unobserved_transaction(self) -> None:
        outside = self.accepted()
        outside.update(
            native_transaction_id="release",
            transaction_status="RELEASED",
            posted_date=self.acquisition.comparable_end_at.date() + timedelta(days=1),
            posted_at=self.acquisition.comparable_end_at + timedelta(days=1),
        )
        transaction = replace(self.prepared.transactions[0], release_transaction_id="release")
        with self.assertRaisesRegex(ValueError, "affected transactions"):
            validate_finances_candidate(
                self.acquisition, replace(self.prepared, transactions=(transaction,)), [outside], []
            )

    def test_financial_component_rules_fail_in_python_before_any_publication(self) -> None:
        transaction = self.prepared.transactions[0]
        component = transaction.components[0]
        for invalid, message in (
            (replace(component, category=AllocationCategory.ANALYSIS_ONLY), "allocation"),
            (replace(component, sku=None), "SKU"),
            (replace(component, quantity=Numeric(-1)), "quantity"),
            (replace(component, fee_base=Numeric(99)), "fee base"),
            (replace(component, breakdown_indexes=(-1, 0)), "breakdown"),
        ):
            candidate = replace(
                self.prepared, transactions=(replace(transaction, components=(invalid,)),)
            )
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                validate_finances_candidate(self.acquisition, candidate, [], [])
