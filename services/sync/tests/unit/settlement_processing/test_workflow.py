"""Tests for oldest-unprocessed selection and atomic Workflow B persistence."""

import unittest
from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from datetime import date
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast
from unittest.mock import ANY, Mock, patch
from uuid import UUID

from ....src.database.company_sku_fee_rates import UnassignedSelboxFeeError
from ....src.numeric import NUMERIC_PRECISION_BOUND, NumericBoundError
from ....src.settlement_processing import repository, workflow
from ....src.settlement_processing.artifacts import ProcessingArtifactLog
from ....src.settlement_processing.ledger_entry_builder import UnrecognizedMarketplaceError
from ....src.settlement_processing.models import (
    AuxiliaryFeeObservation,
    AuxiliaryRequirements,
    PreparedSettlement,
)
from ....src.settlement_processing.workflow import process_settlement_report
from ...support.fakes import FakeDatabaseConnection
from ...support.settlement_processing import (
    SETTLEMENT_REPORT_ID,
    stored_report_database_rows,
)

FEE_RATE_ID = str(UUID(int=201))
COMPANY_ID = str(UUID(int=202))
_ZERO_FEE_RATE_ROW = (
    FEE_RATE_ID,
    "seller-na",
    "ATVPDKIKX0DER",
    "SKU-1",
    COMPANY_ID,
    Decimal(0),
    date(2026, 1, 1),
    None,
)


def _no_auxiliary_observations(
    _settlement: PreparedSettlement,
    _requirements: AuxiliaryRequirements,
    _artifacts: ProcessingArtifactLog,
) -> tuple[AuxiliaryFeeObservation, ...]:
    return ()


class TestSettlementProcessingWorkflow(unittest.TestCase):
    def test_fee_advisory_runs_only_after_successful_commit(self) -> None:
        for commit_fails in (False, True):
            with self.subTest(commit_fails=commit_fails):
                self._assert_fee_advisory_commit_boundary(commit_fails)

    def _assert_fee_advisory_commit_boundary(self, commit_fails: bool) -> None:
        report_row, content_rows = stored_report_database_rows()
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,), report_row],
            fetchall_results=[content_rows, [_ZERO_FEE_RATE_ROW]],
        )
        committed = False

        @contextmanager
        def transaction() -> Generator[None]:
            nonlocal committed
            yield
            if commit_fails:
                raise RuntimeError("commit failed")
            committed = True

        def check_after_commit(*_args: object, **_kwargs: object) -> None:
            self.assertTrue(committed)

        with (
            TemporaryDirectory() as temporary_directory,
            patch.object(database.connection_obj, "transaction", side_effect=transaction),
            patch.object(
                repository, "check_settlement_fee_references", side_effect=check_after_commit
            ) as check,
            self.assertRaisesRegex(RuntimeError, "commit failed")
            if commit_fails
            else nullcontext(),
        ):
            process_settlement_report(
                database,
                _no_auxiliary_observations,
                seller_namespace="seller-na",
                artifact_root=Path(temporary_directory),
            )
        if commit_fails:
            check.assert_not_called()
        else:
            check.assert_called_once_with(database, processing_log_id=ANY)

    def test_missing_fee_logs_error_and_aborts_before_persistence(self) -> None:
        report_row, content_rows = stored_report_database_rows()
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,), report_row], fetchall_results=[content_rows, []]
        )
        with (
            TemporaryDirectory() as temporary_directory,
            self.assertLogs(workflow.__name__, level="ERROR") as logged,
            self.assertRaises(UnassignedSelboxFeeError),
        ):
            process_settlement_report(
                database,
                _no_auxiliary_observations,
                seller_namespace="seller-na",
                artifact_root=Path(temporary_directory),
            )
        self.assertEqual(len(logged.records), 1)
        self.assertIn(SETTLEMENT_REPORT_ID, logged.output[0])
        self.assertIn("sku=SKU-1", logged.output[0])
        self.assertIn("activity_start_date=2026-08-02", logged.output[0])
        self._assert_no_persistence(database)

    def test_zero_fee_assignment_and_account_expenses_remain_valid(self) -> None:
        for account_expense in (False, True):
            with self.subTest(account_expense=account_expense):
                report_row, content_rows = stored_report_database_rows()
                if account_expense:
                    columns = cast(list[str], report_row[5])
                    for row in content_rows:
                        values = cast(list[str], row[2])
                        values[columns.index("amount-description")] = "Subscription Fee"
                        values[columns.index("sku")] = ""
                database = FakeDatabaseConnection(
                    [(SETTLEMENT_REPORT_ID,), report_row],
                    fetchall_results=[
                        content_rows,
                        [] if account_expense else [_ZERO_FEE_RATE_ROW],
                    ],
                )
                with (
                    TemporaryDirectory() as temporary_directory,
                    self.assertNoLogs(workflow.__name__, level="ERROR"),
                ):
                    result = process_settlement_report(
                        database,
                        _no_auxiliary_observations,
                        seller_namespace="seller-na",
                        artifact_root=Path(temporary_directory),
                    )
                self.assertIsNotNone(result.processing_log_id)
                self.assertEqual(database.connection_obj.transaction_count, 1)
                parameters = next(
                    rows
                    for sql, rows in database.executemany_calls
                    if "insert into private.settlement_processed_results" in sql
                )
                for row in parameters:
                    self.assertEqual(row["selbox_fee"], Decimal(0))
                    self.assertEqual(
                        row["company_sku_fee_rate_id"], None if account_expense else FEE_RATE_ID
                    )

    def test_processes_oldest_report_and_appends_run_scoped_results(self) -> None:
        report_row, content_rows = stored_report_database_rows()
        report_values = list(report_row)
        report_values[5] = [
            *cast(list[str], report_values[5]),
            " extra-header ",
        ]
        report_values[6] = [
            *cast(list[str], report_values[6]),
            "  exact metadata cell  ",
        ]
        report_row = tuple(report_values)
        content_rows = [
            (
                row[0],
                row[1],
                [*cast(list[str], row[2]), "  exact content cell  "],
            )
            for row in content_rows
        ]
        fee_rate_row = (
            FEE_RATE_ID,
            "seller-na",
            "ATVPDKIKX0DER",
            "SKU-1",
            COMPANY_ID,
            Decimal("5"),
            date(2026, 1, 1),
            None,
        )
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,), report_row],
            fetchall_results=[content_rows, [fee_rate_row]],
        )

        write_json = ProcessingArtifactLog.write_json

        def reject_post_commit_artifact(
            artifacts: ProcessingArtifactLog,
            relative_path: Path,
            value: object,
        ) -> Path:
            if database.connection_obj.transaction_count:
                raise OSError("simulated disk failure after commit")
            return write_json(artifacts, relative_path, value)

        with (
            TemporaryDirectory() as temporary_directory,
            patch.object(
                ProcessingArtifactLog,
                "write_json",
                reject_post_commit_artifact,
            ),
        ):
            result = process_settlement_report(
                database,
                lambda _settlement, requirements, _artifacts: (
                    () if not requirements.any else self.fail("Unexpected auxiliary requirement")
                ),
                seller_namespace="seller-na",
                artifact_root=Path(temporary_directory),
            )

            self.assertIsNotNone(result.processing_log_id)

        self.assertEqual(result.processed_entry_count, 2)
        self.assertEqual(result.processed_result_count, 2)
        selection_sql = database.execute_calls[0][0]
        self.assertIn("left join private.settlement_processing_logs", selection_sql)
        self.assertIn("processing_log.id is null", selection_sql)
        self.assertTrue(
            any(
                "insert into private.settlement_processing_logs" in sql
                for sql, _ in database.execute_calls
            )
        )
        result_parameters = next(
            parameters
            for sql, parameters in database.executemany_calls
            if "insert into private.settlement_processed_results" in sql
        )
        results_by_category = {row["category_code"]: row for row in result_parameters}
        sale = results_by_category["PRODUCT_SALES"]
        refund = results_by_category["PRODUCT_REFUNDS"]
        self.assertEqual(sale["company_sku_fee_rate_id"], FEE_RATE_ID)
        self.assertEqual(sale["selbox_fee_base"], Decimal("10.00"))
        self.assertEqual(sale["selbox_fee"], Decimal("-0.5000"))
        self.assertEqual(sale["settlement_quantity"], Decimal(1))
        self.assertEqual(sale["selbox_fee_quantity"], Decimal(1))
        self.assertEqual(refund["settlement_quantity"], Decimal(1))
        self.assertEqual(refund["selbox_fee"], Decimal(0))
        self.assertIsNone(refund["selbox_fee_base_quantity"])
        self.assertEqual(
            {row["processing_log_id"] for row in result_parameters}, {result.processing_log_id}
        )
        self.assertEqual(len(database.executemany_calls), 2)
        processed_entry_parameters = next(
            parameters
            for sql, parameters in database.executemany_calls
            if "insert into private.settlement_processed_entries" in sql
        )
        self.assertEqual(
            {(row["settlement_amount"], row["quantity"]) for row in processed_entry_parameters},
            {(Decimal("10.00"), 1), (Decimal("-2.00"), 1)},
        )
        self.assertEqual(
            {
                (row["category_code"], row["pnl_treatment"], row["handling_method"])
                for row in processed_entry_parameters
            },
            {
                ("PRODUCT_SALES", "SKU_PNL", "DIRECT_SKU"),
                ("PRODUCT_REFUNDS", "SKU_PNL", "DIRECT_SKU"),
            },
        )
        self.assertEqual(database.connection_obj.transaction_count, 1)

    def test_no_unprocessed_report_performs_no_other_work(self) -> None:
        database = FakeDatabaseConnection([None])

        def fail_if_loaded(
            _settlement: PreparedSettlement,
            _requirements: AuxiliaryRequirements,
            _artifacts: ProcessingArtifactLog,
        ) -> tuple[AuxiliaryFeeObservation, ...]:
            self.fail("Auxiliary loader must not run")

        with TemporaryDirectory() as temporary_directory:
            result = process_settlement_report(
                database,
                fail_if_loaded,
                seller_namespace="seller-na",
                artifact_root=Path(temporary_directory),
            )
            self.assertEqual(list(Path(temporary_directory).iterdir()), [])

        self.assertTrue(result.no_unprocessed_report)
        self.assertEqual(len(database.execute_calls), 1)

    def test_auxiliary_failure_leaves_database_without_processing_log(self) -> None:
        report_row, content_rows = stored_report_database_rows()
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,), report_row],
            fetchall_results=[content_rows],
        )

        def fail(*_args: object) -> tuple[object, ...]:
            raise RuntimeError("download failed")

        with TemporaryDirectory() as temporary_directory, self.assertRaises(RuntimeError):
            process_settlement_report(
                database,
                fail,  # type: ignore[arg-type]
                seller_namespace="seller-na",
                artifact_root=Path(temporary_directory),
            )

        self.assertFalse(
            any(
                "insert into private.settlement_processing_logs" in sql
                for sql, _ in database.execute_calls
            )
        )
        self.assertEqual(database.connection_obj.transaction_count, 0)

    def test_unrecognized_marketplace_aborts_before_acquisition_artifacts_or_writes(self) -> None:
        for marketplace_count in (1, 2):
            with self.subTest(marketplace_count=marketplace_count):
                report_row, content_rows = stored_report_database_rows()
                report_values = list(report_row)
                report_values[3] = ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2"][:marketplace_count]
                report_values[4] = ["Amazon.com", "Amazon.ca"][:marketplace_count]
                columns = cast(list[str], report_values[5])
                values = cast(list[str], content_rows[-1][2])
                values[columns.index("marketplace-name")] = "Unknown Marketplace"
                database = FakeDatabaseConnection(
                    [(SETTLEMENT_REPORT_ID,), tuple(report_values)],
                    fetchall_results=[content_rows, [_ZERO_FEE_RATE_ROW]],
                )
                auxiliary_loader = Mock(return_value=())

                with (
                    TemporaryDirectory() as temporary_directory,
                    patch.object(
                        ProcessingArtifactLog, "create", wraps=ProcessingArtifactLog.create
                    ) as create_artifacts,
                ):
                    artifact_root = Path(temporary_directory) / "processing"
                    with self.assertRaises(UnrecognizedMarketplaceError) as raised:
                        process_settlement_report(
                            database,
                            auxiliary_loader,
                            seller_namespace="seller-na",
                            artifact_root=artifact_root,
                        )

                    self.assertEqual(raised.exception.source_line_number, 4)
                    auxiliary_loader.assert_not_called()
                    create_artifacts.assert_not_called()
                    self.assertFalse(artifact_root.exists())

                self._assert_no_persistence(database)

    def test_rejects_out_of_range_source_amount_before_auxiliary_work(self) -> None:
        report_row, content_rows = stored_report_database_rows()
        columns = cast(list[str], report_row[5])
        metadata = cast(list[str], report_row[6]).copy()
        metadata[columns.index("total-amount")] = "0"
        report_values = list(report_row)
        report_values[6] = metadata
        out_of_range = "1" + "0" * NUMERIC_PRECISION_BOUND
        changed_rows: list[tuple[object, ...]] = []
        for index, row in enumerate(content_rows):
            values = cast(list[str], row[2]).copy()
            values[columns.index("amount")] = out_of_range if index == 0 else f"-{out_of_range}"
            changed_rows.append((row[0], row[1], values))
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,), tuple(report_values)],
            fetchall_results=[changed_rows],
        )
        auxiliary_loader = Mock()

        with (
            TemporaryDirectory() as temporary_directory,
            self.assertRaises(NumericBoundError),
        ):
            process_settlement_report(
                database,
                auxiliary_loader,
                seller_namespace="seller-na",
                artifact_root=Path(temporary_directory),
            )

        auxiliary_loader.assert_not_called()
        self._assert_no_persistence(database)

    def test_rejects_out_of_range_fee_rate_before_planning(self) -> None:
        report_row, content_rows = stored_report_database_rows()
        fee_rate_row = (
            FEE_RATE_ID,
            "seller-na",
            "ATVPDKIKX0DER",
            "SKU-1",
            COMPANY_ID,
            Decimal("1E-1001"),
            date(2026, 1, 1),
            None,
        )
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,), report_row],
            fetchall_results=[content_rows, [fee_rate_row]],
        )

        with (
            TemporaryDirectory() as temporary_directory,
            self.assertRaises(NumericBoundError),
        ):
            process_settlement_report(
                database,
                _no_auxiliary_observations,
                seller_namespace="seller-na",
                artifact_root=Path(temporary_directory),
            )

        self._assert_no_persistence(database)

    def test_rejects_exact_derived_fee_outside_bound_before_transaction(self) -> None:
        report_row, content_rows = stored_report_database_rows()
        columns = cast(list[str], report_row[5])
        amount = "1" + "0" * (NUMERIC_PRECISION_BOUND - 1)
        report_values = list(report_row)
        metadata = cast(list[str], report_row[6]).copy()
        metadata[columns.index("total-amount")] = amount
        report_values[6] = metadata
        changed_rows: list[tuple[object, ...]] = []
        for index, row in enumerate(content_rows):
            values = cast(list[str], row[2]).copy()
            values[columns.index("amount")] = amount if index == 0 else "0"
            changed_rows.append((row[0], row[1], values))
        fee_rate_row = (
            FEE_RATE_ID,
            "seller-na",
            "ATVPDKIKX0DER",
            "SKU-1",
            COMPANY_ID,
            Decimal(100),
            date(2026, 1, 1),
            None,
        )
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,), tuple(report_values)],
            fetchall_results=[changed_rows, [fee_rate_row]],
        )
        with TemporaryDirectory() as temporary_directory, self.assertRaises(NumericBoundError):
            process_settlement_report(
                database,
                _no_auxiliary_observations,
                seller_namespace="seller-na",
                artifact_root=Path(temporary_directory),
            )
        self._assert_no_persistence(database)

    def _assert_no_persistence(self, database: FakeDatabaseConnection) -> None:
        self.assertFalse(any("insert into" in sql.casefold() for sql, _ in database.execute_calls))
        self.assertFalse(database.executemany_calls)
        self.assertEqual(database.connection_obj.transaction_count, 0)


if __name__ == "__main__":
    unittest.main()
