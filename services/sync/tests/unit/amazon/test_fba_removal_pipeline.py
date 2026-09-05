import hashlib
import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from ....src.amazon.fba_reports.acquisition import download_removal_report
from ....src.amazon.fba_reports.lifecycle import FbaReportFailedError
from ....src.amazon.fba_reports.models import DownloadedRemovalReport
from ....src.amazon.fba_reports.parsing import (
    parse_downloaded_removal_report,
)
from ....src.amazon.fba_reports.processing import build_removal_fee_batch_from_parsed
from ....src.amazon.fba_reports.report_types import FBA_REMOVAL_ORDER_DETAIL_REPORT
from ....src.amazon.reports.models import DownloadedReportDocument
from ....src.amazon.reports.summaries import DoneReportSummary
from ....src.numeric import Numeric


class _Response:
    next_token: str | None = None

    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload


class _CancelledFreshReportClient:
    def __init__(self) -> None:
        self.get_reports_count = 0
        self.created_report_count = 0
        self.document_request_count = 0

    def get_reports(self, **_kwargs: object) -> _Response:
        self.get_reports_count += 1
        return _Response({"reports": []})

    def create_report(self, **_kwargs: object) -> _Response:
        self.created_report_count += 1
        return _Response({"reportId": "fresh-report-id"})

    def get_report(self, report_id: str, **_kwargs: object) -> _Response:
        return _Response({"reportId": report_id, "processingStatus": "CANCELLED"})

    def get_report_document(self, *_args: object, **_kwargs: object) -> _Response:
        self.document_request_count += 1
        raise AssertionError("A cancelled report must not request a document.")


def _done_report() -> dict[str, object]:
    return {
        "reportId": "existing-report",
        "reportDocumentId": "existing-document",
        "reportType": FBA_REMOVAL_ORDER_DETAIL_REPORT,
        "processingStatus": "DONE",
        "createdTime": "2026-08-21T00:00:00Z",
        "dataStartTime": "2026-08-01T00:00:00Z",
        "dataEndTime": "2026-08-20T00:00:00Z",
        "marketplaceIds": ["ATVPDKIKX0DER"],
    }


class _ExistingReportClient:
    def get_reports(self, **_kwargs: object) -> _Response:
        return _Response({"reports": [_done_report()]})

    def create_report(self, **_kwargs: object) -> _Response:
        raise AssertionError("A covering report must be reused.")

    def get_report(self, *_args: object, **_kwargs: object) -> _Response:
        raise AssertionError("A covering report must be reused.")

    def get_report_document(self, *_args: object, **_kwargs: object) -> _Response:
        raise AssertionError("The report download is patched in this test.")


def _document() -> bytes:
    header = (
        "request-date",
        "order-id",
        "order-type",
        "service-speed",
        "order-status",
        "last-updated-date",
        "sku",
        "fnsku",
        "disposition",
        "requested-quantity",
        "cancelled-quantity",
        "disposed-quantity",
        "shipped-quantity",
        "in-process-quantity",
        "removal-fee",
        "currency",
    )
    row = (
        "2026-08-03",
        "removal-1",
        "Return",
        "Standard",
        "Completed",
        "2026-08-04",
        "SKU-A",
        "FNSKU-A",
        "Sellable",
        "1",
        "0",
        "0",
        "1",
        "0",
        "1.234567890123456789",
        "USD",
    )
    return ("\t".join(header) + "\n" + "\t".join(row) + "\n").encode()


def _downloaded_removal_report(content: bytes = _document()) -> DownloadedRemovalReport:
    return DownloadedRemovalReport(
        report_summary=DoneReportSummary(
            report_id="existing-report",
            report_document_id="existing-document",
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            created_at=datetime(2026, 8, 21, tzinfo=UTC),
            data_start_at=datetime(2026, 8, 1, tzinfo=UTC),
            data_end_at=datetime(2026, 8, 20, tzinfo=UTC),
            marketplace_ids=("ATVPDKIKX0DER",),
        ),
        document=DownloadedReportDocument(
            transferred_content=content,
            compression_algorithm=None,
        ),
    )


class TestFbaRemovalPipeline(unittest.TestCase):
    def test_fresh_cancelled_report_fails_without_assuming_no_data(self) -> None:
        client = _CancelledFreshReportClient()
        start_at = datetime(2026, 8, 1, tzinfo=UTC)
        end_at = datetime(2026, 8, 20, tzinfo=UTC)

        with self.assertRaises(FbaReportFailedError) as raised:
            download_removal_report(
                client,
                marketplace_id="A1VC38T7YXB528",
                data_start_at=start_at,
                data_end_at=end_at,
                now=datetime(2026, 8, 29, tzinfo=UTC),
                max_poll_attempts=1,
                poll_interval_seconds=0,
            )

        self.assertEqual(raised.exception.processing_status, "CANCELLED")
        self.assertEqual(client.created_report_count, 1)
        self.assertEqual(client.document_request_count, 0)

    def test_rejects_naive_or_future_windows_before_network(self) -> None:
        client = _CancelledFreshReportClient()
        cases = (
            (
                datetime(2026, 8, 1),  # noqa: DTZ001 - deliberately invalid input
                datetime(2026, 8, 2),  # noqa: DTZ001 - deliberately invalid input
                datetime(2026, 8, 29, tzinfo=UTC),
                "timezone-aware",
            ),
            (
                datetime(2026, 8, 1, tzinfo=UTC),
                datetime(2026, 8, 20, tzinfo=UTC),
                datetime(2026, 8, 10, tzinfo=UTC),
                "future",
            ),
        )

        for start_at, end_at, now, expected_error in cases:
            with (
                self.subTest(expected_error=expected_error),
                self.assertRaisesRegex(ValueError, expected_error),
            ):
                download_removal_report(
                    client,
                    marketplace_id="ATVPDKIKX0DER",
                    data_start_at=start_at,
                    data_end_at=end_at,
                    now=now,
                )

        self.assertEqual(client.get_reports_count, 0)

    @patch(
        "services.sync.src.amazon.fba_reports.acquisition.download_report_document",
        return_value=DownloadedReportDocument(
            transferred_content=b"not a TSV document",
            compression_algorithm=None,
        ),
    )
    def test_download_does_not_depend_on_tsv_parsing(self, _fetch: object) -> None:
        downloaded = download_removal_report(
            _ExistingReportClient(),
            marketplace_id="ATVPDKIKX0DER",
            data_start_at=datetime(2026, 8, 1, tzinfo=UTC),
            data_end_at=datetime(2026, 8, 20, tzinfo=UTC),
            now=datetime(2026, 8, 29, tzinfo=UTC),
        )

        self.assertEqual(downloaded.document.transferred_content, b"not a TSV document")
        parsed_document = parse_downloaded_removal_report(
            downloaded,
            amazon_scope="NA",
        )
        with self.assertRaises(ValueError):
            build_removal_fee_batch_from_parsed(
                downloaded.report_summary,
                parsed_document,
                settlement_report_id="settlement-1",
                seller_namespace="seller-1",
                amazon_scope="NA",
                marketplace_id="ATVPDKIKX0DER",
                data_start_at=datetime(2026, 8, 1, tzinfo=UTC),
                data_end_at=datetime(2026, 8, 20, tzinfo=UTC),
            )

    def test_builder_normalizes_retained_document_without_network(self) -> None:
        downloaded = _downloaded_removal_report()
        parsed_document = parse_downloaded_removal_report(
            downloaded,
            amazon_scope="NA",
        )
        batch = build_removal_fee_batch_from_parsed(
            downloaded.report_summary,
            parsed_document,
            settlement_report_id="settlement-1",
            seller_namespace="seller-1",
            amazon_scope="NA",
            marketplace_id="ATVPDKIKX0DER",
            data_start_at=datetime(2026, 8, 1, tzinfo=UTC),
            data_end_at=datetime(2026, 8, 20, tzinfo=UTC),
        )

        self.assertEqual(parsed_document.content_sha256, hashlib.sha256(_document()).hexdigest())
        self.assertEqual(parsed_document.rows[0].source_line_number, 2)
        self.assertEqual(len(batch.observations), 1)
        self.assertEqual(batch.observations[0].amz_sku, "SKU-A")
        self.assertEqual(
            batch.observations[0].reported_amount,
            Numeric("1.234567890123456789"),
        )


if __name__ == "__main__":
    unittest.main()
