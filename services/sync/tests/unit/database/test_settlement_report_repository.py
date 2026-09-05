"""Tests for Settlement report selection and atomic raw-cell persistence."""

import unittest
from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import patch
from uuid import UUID

from ....src.amazon.settlement_models import SettlementReportReference
from ....src.database.settlement_report_repository import (
    STORED_REPORT_LOOKUP_BATCH_SIZE,
    SettlementReportCandidateSelection,
    SettlementReportPersistenceOutcome,
    persist_settlement_report,
    select_settlement_reports_to_download,
)
from ...support.fakes import FakeDatabaseConnection
from ...support.settlement_reports import make_parsed_settlement_report

MARKETPLACE_ID = "ATVPDKIKX0DER"
SECOND_MARKETPLACE_ID = "A2EUQ1WTGCTBG2"
MARKETPLACE_NAMES = {
    MARKETPLACE_ID: "Amazon.com",
    SECOND_MARKETPLACE_ID: "Amazon.ca",
}
REPORT_CREATED_AT = datetime(2026, 8, 20, 12, tzinfo=UTC)
REPORT_DATA_START_AT = datetime(2026, 8, 1, tzinfo=UTC)
REPORT_DATA_END_AT = datetime(2026, 8, 15, tzinfo=UTC)
SETTLEMENT_REPORT_ID = str(UUID(int=1))


def _reference(
    report_id: str = "report-1",
    document_id: str = "document-1",
    created_at: datetime = REPORT_CREATED_AT,
    marketplace_ids: tuple[str, ...] = (MARKETPLACE_ID,),
    report_data_start_at: datetime | None = None,
    report_data_end_at: datetime | None = None,
) -> SettlementReportReference:
    return SettlementReportReference(
        report_id,
        document_id,
        created_at,
        marketplace_ids,
        report_data_start_at,
        report_data_end_at,
    )


class TestSettlementReportSelection(unittest.TestCase):
    def test_classifies_new_exact_and_anomalous_references_in_one_query(self) -> None:
        references = (
            _reference("report-new", "document-new"),
            _reference("report-exact", "document-exact"),
            _reference("report-anomaly", "document-new-anomaly"),
        )
        database = FakeDatabaseConnection(
            fetchall_results=[
                [
                    (
                        2,
                        "report-exact",
                        "document-exact",
                        REPORT_CREATED_AT,
                        [MARKETPLACE_ID],
                        None,
                        None,
                    ),
                    (
                        3,
                        "report-anomaly",
                        "old-document",
                        REPORT_CREATED_AT,
                        [MARKETPLACE_ID],
                        None,
                        None,
                    ),
                ]
            ]
        )

        selection = select_settlement_reports_to_download(
            database,
            amazon_scope="NA",
            report_references=references,
            seller_namespace="seller-na",
        )

        self.assertEqual(
            selection,
            SettlementReportCandidateSelection((references[0],), 1, 1),
        )
        sql, params = database.execute_calls[0]
        self.assertIn("private.settlement_reports", sql)
        self.assertNotIn("raw_content", sql)
        self.assertEqual(
            params["amazon_report_ids"],
            [reference.report_id for reference in references],
        )
        self.assertEqual(params["seller_namespace"], "seller-na")

    def test_changed_immutable_listing_metadata_is_an_anomaly(self) -> None:
        reference = _reference(
            marketplace_ids=(MARKETPLACE_ID, SECOND_MARKETPLACE_ID),
            report_data_start_at=REPORT_DATA_START_AT,
            report_data_end_at=REPORT_DATA_END_AT,
        )
        database = FakeDatabaseConnection(
            fetchall_results=[
                [
                    (
                        1,
                        reference.report_id,
                        reference.report_document_id,
                        REPORT_CREATED_AT + timedelta(seconds=1),
                        [MARKETPLACE_ID],
                        REPORT_DATA_START_AT + timedelta(seconds=1),
                        REPORT_DATA_END_AT,
                    )
                ]
            ]
        )

        selection = select_settlement_reports_to_download(
            database,
            amazon_scope="NA",
            report_references=(reference,),
            seller_namespace="seller-na",
        )

        self.assertEqual(selection.identity_anomaly_count, 1)
        self.assertEqual(selection.download_candidates, ())

    def test_empty_listing_does_not_open_a_database_connection(self) -> None:
        database = FakeDatabaseConnection()

        selection = select_settlement_reports_to_download(
            database,
            amazon_scope="EU",
            report_references=(),
            seller_namespace="seller-eu",
        )

        self.assertEqual(selection, SettlementReportCandidateSelection((), 0, 0))
        self.assertEqual(database.connection_count, 0)

    def test_selection_uses_bounded_database_batches(self) -> None:
        references = tuple(
            _reference(f"report-{index}", f"document-{index}")
            for index in range(STORED_REPORT_LOOKUP_BATCH_SIZE + 1)
        )
        database = FakeDatabaseConnection(fetchall_results=[[], []])

        selection = select_settlement_reports_to_download(
            database,
            amazon_scope="NA",
            report_references=references,
            seller_namespace="seller-na",
        )

        self.assertEqual(selection.download_candidates, references)
        self.assertEqual(len(database.execute_calls), 2)
        self.assertEqual(
            len(cast(list[object], database.execute_calls[0][1]["amazon_report_ids"])),
            STORED_REPORT_LOOKUP_BATCH_SIZE,
        )
        self.assertEqual(
            len(cast(list[object], database.execute_calls[1][1]["amazon_report_ids"])),
            1,
        )


class TestSettlementReportPersistence(unittest.TestCase):
    def test_inserts_report_metadata_and_all_raw_rows_under_advisory_locks(self) -> None:
        parsed_report = make_parsed_settlement_report()
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,)],
            fetchall_results=[[]],
        )

        outcome = persist_settlement_report(
            database,
            parsed_report,
            _reference(
                marketplace_ids=(MARKETPLACE_ID, SECOND_MARKETPLACE_ID),
                report_data_start_at=REPORT_DATA_START_AT,
                report_data_end_at=REPORT_DATA_END_AT,
            ),
            marketplace_names_by_id=MARKETPLACE_NAMES,
            seller_namespace="seller-na",
            amazon_scope="NA",
        )

        self.assertIs(outcome, SettlementReportPersistenceOutcome.INSERTED)
        lock_sql = database.execute_calls[0][0]
        self.assertIn("pg_advisory_xact_lock", lock_sql)
        self.assertIn("order by identity_key.value", lock_sql)
        insert_sql, insert_params = database.execute_calls[2]
        self.assertIn("insert into private.settlement_reports", insert_sql)
        self.assertNotIn("raw_content", insert_sql)
        self.assertEqual(insert_params["amazon_report_id"], "report-1")
        self.assertEqual(insert_params["amazon_document_id"], "document-1")
        self.assertEqual(insert_params["amazon_report_data_start_at"], REPORT_DATA_START_AT)
        self.assertEqual(insert_params["amazon_report_data_end_at"], REPORT_DATA_END_AT)
        self.assertEqual(insert_params["content_row_count"], parsed_report.content_row_count)
        self.assertEqual(
            insert_params["marketplace_ids"],
            [MARKETPLACE_ID, SECOND_MARKETPLACE_ID],
        )
        self.assertEqual(
            insert_params["marketplace_names"],
            ["Amazon.com", "Amazon.ca"],
        )
        self.assertEqual(insert_params["tsv_columns"], list(parsed_report.tsv_columns))
        self.assertEqual(insert_params["metadata_values"], list(parsed_report.metadata_values))
        row_sql, row_params = database.executemany_calls[0]
        self.assertIn("insert into private.settlement_report_rows", row_sql)
        self.assertEqual(len(row_params), parsed_report.content_row_count)
        self.assertEqual(row_params[0]["settlement_report_id"], SETTLEMENT_REPORT_ID)
        self.assertEqual(
            row_params[0]["column_values"],
            list(parsed_report.content_rows[0].column_values),
        )

    def test_exact_race_is_an_idempotent_no_write(self) -> None:
        database = FakeDatabaseConnection(
            fetchall_results=[
                [
                    (
                        "report-1",
                        "document-1",
                        REPORT_CREATED_AT,
                        [MARKETPLACE_ID],
                        None,
                        None,
                    )
                ]
            ]
        )

        outcome = persist_settlement_report(
            database,
            make_parsed_settlement_report(),
            _reference(),
            marketplace_names_by_id=MARKETPLACE_NAMES,
            seller_namespace="seller-na",
            amazon_scope="NA",
        )

        self.assertIs(outcome, SettlementReportPersistenceOutcome.EXACT_RERUN)
        self.assertEqual(len(database.execute_calls), 2)
        self.assertEqual(database.executemany_calls, [])

    def test_identity_race_is_an_anomaly_with_no_write(self) -> None:
        database = FakeDatabaseConnection(
            fetchall_results=[
                [
                    (
                        "report-1",
                        "different-document",
                        REPORT_CREATED_AT,
                        [MARKETPLACE_ID],
                        None,
                        None,
                    )
                ]
            ]
        )

        outcome = persist_settlement_report(
            database,
            make_parsed_settlement_report(),
            _reference(),
            marketplace_names_by_id=MARKETPLACE_NAMES,
            seller_namespace="seller-na",
            amazon_scope="NA",
        )

        self.assertIs(outcome, SettlementReportPersistenceOutcome.IDENTITY_ANOMALY)
        self.assertEqual(len(database.execute_calls), 2)
        self.assertEqual(database.executemany_calls, [])

    def test_rejects_invalid_reference_before_database_access(self) -> None:
        database = FakeDatabaseConnection()

        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            persist_settlement_report(
                database,
                make_parsed_settlement_report(),
                _reference(created_at=datetime(2026, 8, 20, 12)),  # noqa: DTZ001
                marketplace_names_by_id=MARKETPLACE_NAMES,
                seller_namespace="seller-na",
                amazon_scope="NA",
            )
        with self.assertRaisesRegex(ValueError, "duplicates"):
            persist_settlement_report(
                database,
                make_parsed_settlement_report(),
                _reference(marketplace_ids=(MARKETPLACE_ID, MARKETPLACE_ID)),
                marketplace_names_by_id=MARKETPLACE_NAMES,
                seller_namespace="seller-na",
                amazon_scope="NA",
            )
        with self.assertRaisesRegex(ValueError, "data start"):
            persist_settlement_report(
                database,
                make_parsed_settlement_report(),
                _reference(
                    report_data_start_at=REPORT_DATA_END_AT,
                    report_data_end_at=REPORT_DATA_START_AT,
                ),
                marketplace_names_by_id=MARKETPLACE_NAMES,
                seller_namespace="seller-na",
                amazon_scope="NA",
            )

        self.assertEqual(database.connection_count, 0)

    def test_rejects_missing_marketplace_name_before_database_access(self) -> None:
        database = FakeDatabaseConnection()

        with self.assertRaisesRegex(ValueError, "no active marketplace name"):
            persist_settlement_report(
                database,
                make_parsed_settlement_report(),
                _reference(),
                marketplace_names_by_id={},
                seller_namespace="seller-na",
                amazon_scope="NA",
            )

        self.assertEqual(database.connection_count, 0)

    def test_row_insert_failure_propagates_out_of_the_transaction(self) -> None:
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,)],
            fetchall_results=[[]],
        )

        with (
            patch.object(
                database.cursor_obj,
                "executemany",
                side_effect=RuntimeError("row insert failed"),
            ),
            self.assertRaisesRegex(RuntimeError, "row insert failed"),
        ):
            persist_settlement_report(
                database,
                make_parsed_settlement_report(),
                _reference(),
                marketplace_names_by_id=MARKETPLACE_NAMES,
                seller_namespace="seller-na",
                amazon_scope="NA",
            )

        self.assertTrue(
            any(
                "insert into private.settlement_reports" in sql
                for sql, _params in database.execute_calls
            )
        )


if __name__ == "__main__":
    unittest.main()
