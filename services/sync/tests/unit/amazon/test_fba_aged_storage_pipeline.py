"""Tests for one-month FBA aged-storage report acquisition batches."""

import gzip
import hashlib
import unittest
from datetime import UTC, datetime
from typing import cast
from unittest.mock import Mock, patch

from ....src.amazon import fba_reports
from ....src.amazon.fba_reports import acquisition as fba_acquisition
from ....src.amazon.fba_reports import parsing as fba_parsing
from ....src.amazon.fba_reports import processing as fba_processing
from ....src.amazon.fba_reports.acquisition import download_aged_storage_report
from ....src.amazon.fba_reports.lifecycle import FbaReportFailedError
from ....src.amazon.fba_reports.models import AgedStorageReportWindow
from ....src.amazon.fba_reports.parsing import (
    parse_downloaded_aged_storage_report,
)
from ....src.amazon.fba_reports.processing import build_aged_storage_fee_batch_from_parsed
from ....src.amazon.fba_reports.report_types import FBA_AGED_STORAGE_FEE_REPORT
from ....src.amazon.fba_reports.requests import (
    calendar_month_aged_storage_windows,
    validate_aged_storage_window,
)
from ....src.amazon.marketplaces import CREDENTIAL_SCOPES
from ....src.amazon.reports.models import (
    DownloadedReportDocument,
    ReportDocumentCompression,
)
from ....src.numeric import Numeric

NA_MARKETPLACE_ID = cast(str, CREDENTIAL_SCOPES["NA"].client_marketplace.marketplace_id)


class _Response:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.next_token = None


class _ReportsClient:
    def __init__(
        self,
        *,
        reports: list[dict[str, object]],
        statuses: list[dict[str, object]] | None = None,
    ) -> None:
        self.reports = reports
        self.statuses = list(statuses or [])
        self.get_reports_call_count = 0
        self.create_calls: list[dict[str, object]] = []

    def get_reports(self, **_kwargs: object) -> _Response:
        self.get_reports_call_count += 1
        return _Response({"reports": self.reports})

    def create_report(self, **kwargs: object) -> _Response:
        self.create_calls.append(kwargs)
        return _Response({"reportId": "created-report"})

    def get_report(self, _report_id: str, **_kwargs: object) -> _Response:
        return _Response(self.statuses.pop(0))

    def get_report_document(self, *_args: object, **_kwargs: object) -> _Response:
        raise AssertionError("This test client must not download a report document.")


def _done_report() -> dict[str, object]:
    return {
        "reportId": "existing-report",
        "reportDocumentId": "existing-document",
        "reportType": FBA_AGED_STORAGE_FEE_REPORT,
        "processingStatus": "DONE",
        "createdTime": "2026-08-20T12:00:00Z",
        "dataStartTime": "2026-08-01T00:00:00Z",
        "dataEndTime": "2026-09-01T00:00:00Z",
        "marketplaceIds": [NA_MARKETPLACE_ID],
    }


def _document() -> bytes:
    header = (
        "snapshot-date",
        "sku",
        "fnsku",
        "asin",
        "product-name",
        "condition",
        "per-unit-volume",
        "currency",
        "volume-unit",
        "country",
        "qty-charged",
        "amount-charged",
        "surcharge-age-tier",
        "rate-surcharge",
    )
    rows = (
        (
            "2026-08-05",
            "SKU-A",
            "FNSKU-A",
            "ASIN-A",
            "Product A",
            "New",
            "1",
            "USD",
            "cubic-foot",
            "US",
            "1",
            "0.1234567890123456789",
            "365+ days",
            "0.50",
        ),
        (
            "2026-08-20",
            "SKU-B",
            "FNSKU-B",
            "ASIN-B",
            "Product B",
            "New",
            "1",
            "USD",
            "cubic-foot",
            "US",
            "1",
            "2.00",
            "365+ days",
            "0.50",
        ),
    )
    return ("\n".join(("\t".join(header), *("\t".join(row) for row in rows))) + "\n").encode()


def _downloaded_document(
    content: bytes | None = None,
    *,
    compression_algorithm: ReportDocumentCompression = None,
) -> DownloadedReportDocument:
    return DownloadedReportDocument(
        transferred_content=_document() if content is None else content,
        compression_algorithm=compression_algorithm,
    )


def _august_window() -> AgedStorageReportWindow:
    return AgedStorageReportWindow(
        evidence_start_at=datetime(2026, 8, 2, tzinfo=UTC),
        evidence_end_at=datetime(2026, 8, 14, 23, 59, tzinfo=UTC),
        report_request_start_at=datetime(2026, 8, 1, tzinfo=UTC),
        report_request_end_at=datetime(2026, 9, 1, tzinfo=UTC),
    )


class TestFbaAgedStoragePipeline(unittest.TestCase):
    def test_acquisition_and_processing_modules_have_one_way_boundaries(self) -> None:
        self.assertTrue(
            {
                "download_aged_storage_report",
                "download_removal_report",
                "parse_downloaded_aged_storage_report",
                "parse_downloaded_removal_report",
            }.isdisjoint(vars(fba_reports))
        )
        self.assertTrue(
            {
                "decompress_report_document",
                "normalize_parsed_aged_storage_fee_document",
                "normalize_parsed_removal_fee_document",
                "parse_downloaded_aged_storage_report",
                "parse_downloaded_removal_report",
            }.isdisjoint(vars(fba_acquisition))
        )
        self.assertTrue(
            {
                "DownloadedAgedStorageReport",
                "DownloadedRemovalReport",
                "FbaReportsClient",
                "decompress_report_document",
                "download_aged_storage_report",
                "download_report_document",
                "download_removal_report",
                "obtain_fba_report",
                "parse_downloaded_aged_storage_report",
                "parse_downloaded_removal_report",
            }.isdisjoint(vars(fba_processing))
        )
        self.assertTrue(
            {
                "build_aged_storage_fee_batch_from_parsed",
                "build_removal_fee_batch_from_parsed",
                "normalize_parsed_aged_storage_fee_document",
                "normalize_parsed_removal_fee_document",
            }.isdisjoint(vars(fba_parsing))
        )

    def test_splits_evidence_at_exact_calendar_month_boundaries(self) -> None:
        windows = calendar_month_aged_storage_windows(
            datetime(2026, 8, 20, 12, tzinfo=UTC),
            datetime(2026, 9, 2, 8, tzinfo=UTC),
        )

        self.assertEqual(len(windows), 2)
        self.assertEqual(windows[0].report_request_start_at, datetime(2026, 8, 1, tzinfo=UTC))
        self.assertEqual(windows[0].report_request_end_at, datetime(2026, 9, 1, tzinfo=UTC))
        self.assertEqual(windows[1].report_request_start_at, datetime(2026, 9, 1, tzinfo=UTC))
        self.assertEqual(windows[1].report_request_end_at, datetime(2026, 10, 1, tzinfo=UTC))
        self.assertEqual(windows[0].evidence_start_at, datetime(2026, 8, 20, 12, tzinfo=UTC))
        self.assertEqual(windows[1].evidence_end_at, datetime(2026, 9, 2, 8, tzinfo=UTC))

    @patch(
        "services.sync.src.amazon.fba_reports.acquisition.download_report_document",
        return_value=_downloaded_document(),
    )
    def test_reuses_covering_report_and_filters_to_settlement_slice(self, _fetch: object) -> None:
        client = _ReportsClient(reports=[_done_report()])

        downloaded = download_aged_storage_report(
            client,
            marketplace_id=NA_MARKETPLACE_ID,
            window=_august_window(),
            now=datetime(2026, 9, 2, tzinfo=UTC),
        )
        parsed_document = parse_downloaded_aged_storage_report(
            downloaded,
            amazon_scope="NA",
        )
        batch = build_aged_storage_fee_batch_from_parsed(
            downloaded.report_summary,
            parsed_document,
            settlement_report_id="settlement-1",
            seller_namespace="seller-1",
            amazon_scope="NA",
            marketplace_id=NA_MARKETPLACE_ID,
            window=_august_window(),
        )

        self.assertEqual(client.create_calls, [])
        self.assertEqual(parsed_document.content_sha256, hashlib.sha256(_document()).hexdigest())
        self.assertEqual([row.source_line_number for row in parsed_document.rows], [2, 3])
        self.assertEqual(len(batch.observations), 1)
        self.assertEqual(batch.observations[0].amz_sku, "SKU-A")
        self.assertEqual(
            batch.observations[0].reported_amount,
            Numeric("0.1234567890123456789"),
        )
        self.assertEqual(batch.source_start_date.isoformat(), "2026-08-02")
        self.assertEqual(batch.source_end_date.isoformat(), "2026-08-14")

    @patch(
        "services.sync.src.amazon.fba_reports.acquisition.download_report_document",
        return_value=_downloaded_document(),
    )
    def test_new_request_uses_exactly_one_calendar_month(self, _fetch: object) -> None:
        done = _done_report() | {
            "reportId": "created-report",
            "reportDocumentId": "created-document",
        }
        client = _ReportsClient(reports=[], statuses=[done])

        download_aged_storage_report(
            client,
            marketplace_id=NA_MARKETPLACE_ID,
            window=_august_window(),
            now=datetime(2026, 9, 1, tzinfo=UTC),
            max_poll_attempts=1,
            poll_interval_seconds=0,
        )

        self.assertEqual(len(client.create_calls), 1)
        request = client.create_calls[0]
        self.assertEqual(request["dataStartTime"], datetime(2026, 8, 1, tzinfo=UTC))
        self.assertEqual(request["dataEndTime"], datetime(2026, 9, 1, tzinfo=UTC))

    def test_rejects_open_calendar_month_before_any_network_call(self) -> None:
        client = _ReportsClient(reports=[])

        with self.assertRaisesRegex(ValueError, "month must be closed"):
            download_aged_storage_report(
                client,
                marketplace_id=NA_MARKETPLACE_ID,
                window=_august_window(),
                now=datetime(2026, 8, 31, 23, 59, 59, tzinfo=UTC),
            )

        self.assertEqual(client.get_reports_call_count, 0)
        self.assertEqual(client.create_calls, [])

    @patch("services.sync.src.amazon.fba_reports.acquisition.download_report_document")
    def test_fresh_cancelled_report_fails_without_persisting_assumed_no_data(
        self,
        fetch_document: Mock,
    ) -> None:
        client = _ReportsClient(
            reports=[],
            statuses=[
                {
                    "reportId": "created-report",
                    "processingStatus": "CANCELLED",
                }
            ],
        )

        with self.assertRaises(FbaReportFailedError) as raised:
            download_aged_storage_report(
                client,
                marketplace_id=NA_MARKETPLACE_ID,
                window=_august_window(),
                now=datetime(2026, 9, 1, tzinfo=UTC),
                max_poll_attempts=1,
                poll_interval_seconds=0,
            )

        self.assertEqual(raised.exception.processing_status, "CANCELLED")
        fetch_document.assert_not_called()

    def test_rejects_non_monthly_request_window(self) -> None:
        malformed = AgedStorageReportWindow(
            evidence_start_at=datetime(2026, 8, 2, tzinfo=UTC),
            evidence_end_at=datetime(2026, 8, 14, tzinfo=UTC),
            report_request_start_at=datetime(2026, 8, 1, tzinfo=UTC),
            report_request_end_at=datetime(2026, 8, 31, tzinfo=UTC),
        )
        with self.assertRaisesRegex(ValueError, "exactly one calendar month"):
            validate_aged_storage_window(malformed)

    def test_rejects_naive_acquisition_time_before_network(self) -> None:
        client = _ReportsClient(reports=[])
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            download_aged_storage_report(
                client,
                marketplace_id=NA_MARKETPLACE_ID,
                window=_august_window(),
                now=datetime(2026, 8, 22, tzinfo=UTC).replace(tzinfo=None),
            )

    @patch(
        "services.sync.src.amazon.fba_reports.acquisition.download_report_document",
        return_value=_downloaded_document(b"not a TSV document"),
    )
    def test_download_succeeds_even_when_later_parsing_fails(self, _fetch: object) -> None:
        downloaded = download_aged_storage_report(
            _ReportsClient(reports=[_done_report()]),
            marketplace_id=NA_MARKETPLACE_ID,
            window=_august_window(),
            now=datetime(2026, 9, 2, tzinfo=UTC),
        )

        self.assertEqual(downloaded.document.transferred_content, b"not a TSV document")
        parsed_document = parse_downloaded_aged_storage_report(
            downloaded,
            amazon_scope="NA",
        )
        with self.assertRaises(ValueError):
            build_aged_storage_fee_batch_from_parsed(
                downloaded.report_summary,
                parsed_document,
                settlement_report_id="settlement-1",
                seller_namespace="seller-1",
                amazon_scope="NA",
                marketplace_id=NA_MARKETPLACE_ID,
                window=_august_window(),
            )

    @patch("services.sync.src.amazon.fba_reports.acquisition.download_report_document")
    def test_parser_decompresses_before_normalization(
        self,
        fetch_document: Mock,
    ) -> None:
        transferred_content = gzip.compress(_document())
        fetch_document.return_value = _downloaded_document(
            transferred_content,
            compression_algorithm="GZIP",
        )
        downloaded = download_aged_storage_report(
            _ReportsClient(reports=[_done_report()]),
            marketplace_id=NA_MARKETPLACE_ID,
            window=_august_window(),
            now=datetime(2026, 9, 2, tzinfo=UTC),
        )

        parsed_document = parse_downloaded_aged_storage_report(
            downloaded,
            amazon_scope="NA",
        )
        batch = build_aged_storage_fee_batch_from_parsed(
            downloaded.report_summary,
            parsed_document,
            settlement_report_id="settlement-1",
            seller_namespace="seller-1",
            amazon_scope="NA",
            marketplace_id=NA_MARKETPLACE_ID,
            window=_august_window(),
        )

        self.assertEqual(len(batch.observations), 1)


if __name__ == "__main__":
    unittest.main()
