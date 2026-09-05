"""Tests for the Settlement download-and-parse boundary."""

import gzip
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from uuid import UUID

from ....src.amazon.reports import documents as amazon_report_documents
from ....src.amazon.reports.errors import ReportDocumentDownloadError
from ....src.database.settlement_report_repository import (
    SettlementReportPersistenceOutcome,
)
from ....src.settlements.download_and_parse import (
    SettlementDownloadAndParseResult,
    download_and_parse_settlement_reports,
)
from ...support.fakes import FakeDatabaseConnection
from ...support.settlement_reports import FakeClient, FakeResponse, make_report_text

MARKETPLACE_ID = "ATVPDKIKX0DER"
MARKETPLACE_NAME = "Amazon.com"
SETTLEMENT_REPORT_ID = str(UUID(int=1))
REPORT_CREATED_AT = datetime(2026, 8, 20, 12, 34, 56, tzinfo=UTC)
REPORT_DATA_START_AT = datetime(2026, 8, 1, tzinfo=UTC)
REPORT_DATA_END_AT = datetime(2026, 8, 15, tzinfo=UTC)


def _report_summary(
    report_id: str,
    document_id: str,
    created_at: datetime,
) -> dict[str, object]:
    return {
        "reportId": report_id,
        "reportDocumentId": document_id,
        "createdTime": created_at.isoformat().replace("+00:00", "Z"),
        "dataStartTime": REPORT_DATA_START_AT.isoformat().replace("+00:00", "Z"),
        "dataEndTime": REPORT_DATA_END_AT.isoformat().replace("+00:00", "Z"),
        "marketplaceIds": [MARKETPLACE_ID],
    }


def _run(
    client: FakeClient,
    database: FakeDatabaseConnection,
) -> SettlementDownloadAndParseResult:
    return download_and_parse_settlement_reports(
        client,
        database,
        amazon_scope="NA",
        marketplace_ids=(MARKETPLACE_ID,),
        marketplace_names_by_id={MARKETPLACE_ID: MARKETPLACE_NAME},
        seller_namespace="seller-na",
    )


class TestSettlementDownloadAndParse(unittest.TestCase):
    def test_downloads_parses_and_atomically_inserts_report_and_all_rows(self) -> None:
        client = FakeClient(
            make_report_text(),
            reports=[_report_summary("report-1", "document-1", REPORT_CREATED_AT)],
        )
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,)],
            fetchall_results=[[], []],
        )

        with patch.object(
            amazon_report_documents,
            "download_presigned_report_bytes",
            side_effect=client.download_document_bytes,
        ):
            result = _run(client, database)

        self.assertEqual(
            result,
            SettlementDownloadAndParseResult(
                listed_count=1,
                inserted_count=1,
                already_stored_count=0,
                identity_anomaly_count=0,
                download_failed_count=0,
                parse_failed_count=0,
                persistence_failed_count=0,
            ),
        )
        self.assertEqual(client.downloads, ["document-1"])
        self.assertEqual(client.get_reports_calls[0]["processingStatuses"], ["DONE"])
        insert_sql, insert_params = next(
            (sql, params)
            for sql, params in database.execute_calls
            if "insert into private.settlement_reports" in sql
        )
        self.assertNotIn("raw_content", insert_sql)
        self.assertEqual(insert_params["amazon_report_id"], "report-1")
        self.assertEqual(insert_params["amazon_document_id"], "document-1")
        self.assertEqual(insert_params["amazon_report_data_start_at"], REPORT_DATA_START_AT)
        self.assertEqual(insert_params["amazon_report_data_end_at"], REPORT_DATA_END_AT)
        self.assertEqual(insert_params["marketplace_ids"], [MARKETPLACE_ID])
        self.assertEqual(insert_params["marketplace_names"], [MARKETPLACE_NAME])
        self.assertEqual(insert_params["content_row_count"], 2)
        self.assertEqual(len(database.executemany_calls[0][1]), 2)
        self.assertTrue(
            any("pg_advisory_xact_lock" in sql for sql, _params in database.execute_calls)
        )

    def test_decompresses_gzip_before_parsing_and_never_stores_transfer_bytes(self) -> None:
        client = FakeClient(make_report_text())
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,)],
            fetchall_results=[[], []],
        )
        transferred_content = gzip.compress(make_report_text().encode())

        with (
            patch.object(
                client,
                "get_report_document",
                return_value=FakeResponse(
                    {
                        "reportDocumentId": "document-1",
                        "url": "https://download.invalid/document-1",
                        "compressionAlgorithm": "GZIP",
                    },
                    None,
                ),
            ),
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                return_value=transferred_content,
            ),
        ):
            result = _run(client, database)

        self.assertEqual(result.inserted_count, 1)
        all_parameters = [params for _sql, params in database.execute_calls]
        self.assertFalse(
            any(transferred_content in parameters.values() for parameters in all_parameters)
        )

    def test_filters_exact_and_anomalous_identities_before_download(self) -> None:
        second_created_at = REPORT_CREATED_AT + timedelta(days=1)
        client = FakeClient(
            make_report_text(),
            reports=[
                _report_summary("report-1", "document-1", REPORT_CREATED_AT),
                _report_summary("report-2", "document-2", second_created_at),
            ],
        )
        database = FakeDatabaseConnection(
            fetchall_results=[
                [
                    (
                        1,
                        "report-1",
                        "document-1",
                        REPORT_CREATED_AT,
                        [MARKETPLACE_ID],
                        REPORT_DATA_START_AT,
                        REPORT_DATA_END_AT,
                    ),
                    (
                        2,
                        "report-2",
                        "different-document",
                        second_created_at,
                        [MARKETPLACE_ID],
                        REPORT_DATA_START_AT,
                        REPORT_DATA_END_AT,
                    ),
                ]
            ]
        )

        with self.assertLogs(
            "services.sync.src.settlements.download_and_parse",
            level="ERROR",
        ) as captured_logs:
            result = _run(client, database)

        self.assertEqual(result.already_stored_count, 1)
        self.assertEqual(result.identity_anomaly_count, 1)
        self.assertEqual(result.failed_count, 1)
        self.assertEqual(client.downloads, [])
        self.assertEqual(len(database.execute_calls), 1)
        self.assertIn("identity anomaly", "\n".join(captured_logs.output))

    def test_discovery_identity_collisions_are_log_only_terminal_outcomes(self) -> None:
        client = FakeClient(
            make_report_text(),
            reports=[
                _report_summary("private-report-1", "private-document-1", REPORT_CREATED_AT),
                _report_summary("private-report-1", "private-document-2", REPORT_CREATED_AT),
                _report_summary("private-report-2", "private-document-2", REPORT_CREATED_AT),
            ],
        )
        database = FakeDatabaseConnection()

        with self.assertLogs(level="ERROR") as captured_logs:
            result = _run(client, database)

        self.assertEqual(
            result,
            SettlementDownloadAndParseResult(
                listed_count=2,
                inserted_count=0,
                already_stored_count=0,
                identity_anomaly_count=2,
                download_failed_count=0,
                parse_failed_count=0,
                persistence_failed_count=0,
            ),
        )
        self.assertEqual(result.terminal_count, result.listed_count)
        self.assertEqual(client.downloads, [])
        self.assertEqual(database.connection_count, 0)
        logs = "\n".join(captured_logs.output)
        self.assertIn("identity anomalies", logs)
        for raw_identity in (
            "private-report-1",
            "private-report-2",
            "private-document-1",
            "private-document-2",
        ):
            self.assertNotIn(raw_identity, logs)

    def test_parse_failure_logs_only_and_does_not_write_to_database(self) -> None:
        client = FakeClient("not a settlement report")
        database = FakeDatabaseConnection(fetchall_results=[[]])

        with (
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                side_effect=client.download_document_bytes,
            ),
            self.assertLogs(
                "services.sync.src.settlements.download_and_parse",
                level="ERROR",
            ) as captured_logs,
        ):
            result = _run(client, database)

        self.assertEqual(result.parse_failed_count, 1)
        self.assertEqual(len(database.execute_calls), 1)
        self.assertEqual(database.executemany_calls, [])
        self.assertIn("parse failed", "\n".join(captured_logs.output))

    def test_parse_failure_does_not_prevent_later_report_insertion(self) -> None:
        client = FakeClient(
            make_report_text(),
            reports=[
                _report_summary("report-bad", "document-bad", REPORT_CREATED_AT),
                _report_summary(
                    "report-good",
                    "document-good",
                    REPORT_CREATED_AT + timedelta(hours=1),
                ),
            ],
            document_texts={"document-bad": "not a settlement report"},
        )
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,)],
            fetchall_results=[[], []],
        )

        with (
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                side_effect=client.download_document_bytes,
            ),
            self.assertLogs(
                "services.sync.src.settlements.download_and_parse",
                level="ERROR",
            ),
        ):
            result = _run(client, database)

        self.assertEqual(result.parse_failed_count, 1)
        self.assertEqual(result.inserted_count, 1)
        self.assertEqual(client.downloads, ["document-bad", "document-good"])

    def test_download_failure_does_not_prevent_later_report_insertion(self) -> None:
        client = FakeClient(
            make_report_text(),
            reports=[
                _report_summary("report-bad", "document-bad", REPORT_CREATED_AT),
                _report_summary(
                    "report-good",
                    "document-good",
                    REPORT_CREATED_AT + timedelta(hours=1),
                ),
            ],
        )
        database = FakeDatabaseConnection(
            [(SETTLEMENT_REPORT_ID,)],
            fetchall_results=[[], []],
        )

        def download(document_url: str) -> bytes:
            if document_url.endswith("document-bad"):
                raise ReportDocumentDownloadError("sanitized transfer failure")
            return client.download_document_bytes(document_url)

        with (
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                side_effect=download,
            ),
            self.assertLogs(
                "services.sync.src.settlements.download_and_parse",
                level="ERROR",
            ),
        ):
            result = _run(client, database)

        self.assertEqual(result.download_failed_count, 1)
        self.assertEqual(result.inserted_count, 1)
        self.assertEqual(client.downloads, ["document-bad", "document-good"])

    def test_persistence_failure_does_not_prevent_later_report(self) -> None:
        client = FakeClient(
            make_report_text(),
            reports=[
                _report_summary("report-1", "document-1", REPORT_CREATED_AT),
                _report_summary(
                    "report-2",
                    "document-2",
                    REPORT_CREATED_AT + timedelta(hours=1),
                ),
            ],
        )
        database = FakeDatabaseConnection(fetchall_results=[[]])

        with (
            patch.object(
                amazon_report_documents,
                "download_presigned_report_bytes",
                side_effect=client.download_document_bytes,
            ),
            patch(
                "services.sync.src.settlements.download_and_parse.persist_settlement_report",
                side_effect=(
                    RuntimeError("database failure"),
                    SettlementReportPersistenceOutcome.INSERTED,
                ),
            ),
            self.assertLogs(
                "services.sync.src.settlements.download_and_parse",
                level="ERROR",
            ),
        ):
            result = _run(client, database)

        self.assertEqual(result.persistence_failed_count, 1)
        self.assertEqual(result.inserted_count, 1)
        self.assertEqual(client.downloads, ["document-1", "document-2"])

    def test_uses_exact_90_day_done_report_window(self) -> None:
        client = FakeClient(make_report_text(), reports=[])
        database = FakeDatabaseConnection()

        result = _run(client, database)

        self.assertEqual(result.listed_count, 0)
        created_since = datetime.fromisoformat(str(client.get_reports_calls[0]["createdSince"]))
        created_until = datetime.fromisoformat(str(client.get_reports_calls[0]["createdUntil"]))
        self.assertEqual(created_until - created_since, timedelta(days=90))
        self.assertEqual(database.connection_count, 0)

    def test_result_rejects_incomplete_terminal_accounting(self) -> None:
        with self.assertRaisesRegex(ValueError, "cover"):
            SettlementDownloadAndParseResult(
                listed_count=1,
                inserted_count=0,
                already_stored_count=0,
                identity_anomaly_count=0,
                download_failed_count=0,
                parse_failed_count=0,
                persistence_failed_count=0,
            )


if __name__ == "__main__":
    unittest.main()
