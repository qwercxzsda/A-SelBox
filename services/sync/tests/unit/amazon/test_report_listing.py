import unittest
from datetime import UTC, datetime, timedelta, timezone

from ....src.amazon.reports.listing import (
    ReportIdentityCollision,
    ReportIdentityIndex,
    format_reports_datetime,
    marketplace_id_chunks,
)


class TestReportListingMechanics(unittest.TestCase):
    def test_formats_request_datetime_as_utc(self) -> None:
        local_time = datetime(2026, 8, 20, 21, 34, 56, tzinfo=timezone(timedelta(hours=9)))

        self.assertEqual(format_reports_datetime(local_time), "2026-08-20T12:34:56Z")

    def test_preserves_fractional_seconds_at_request_boundaries(self) -> None:
        local_time = datetime(2026, 8, 20, 21, 34, 56, 123456, tzinfo=timezone(timedelta(hours=9)))

        self.assertEqual(
            format_reports_datetime(local_time),
            "2026-08-20T12:34:56.123456Z",
        )

    def test_chunks_marketplaces_at_the_reports_api_limit(self) -> None:
        marketplace_ids = tuple(f"marketplace-{index}" for index in range(21))

        self.assertEqual(
            tuple(marketplace_id_chunks(marketplace_ids)),
            (
                marketplace_ids[:10],
                marketplace_ids[10:20],
                marketplace_ids[20:],
            ),
        )
        with self.assertRaisesRegex(ValueError, "At least one marketplace ID"):
            tuple(marketplace_id_chunks(()))

    def test_detects_report_and_document_identity_collisions(self) -> None:
        index: ReportIdentityIndex[tuple[str, datetime]] = ReportIdentityIndex()
        first_metadata = ("DONE", datetime(2026, 8, 20, tzinfo=UTC))

        self.assertIsNone(
            index.record(
                report_id="report-1",
                report_document_id="document-1",
                metadata=first_metadata,
            )
        )
        self.assertIsNone(
            index.record(
                report_id="report-1",
                report_document_id="document-1",
                metadata=first_metadata,
            )
        )
        self.assertIs(
            index.record(
                report_id="report-1",
                report_document_id="document-2",
                metadata=first_metadata,
            ),
            ReportIdentityCollision.CONFLICTING_METADATA,
        )
        self.assertIs(
            index.record(
                report_id="report-1",
                report_document_id="document-2",
                metadata=("DONE", datetime(2026, 8, 21, tzinfo=UTC)),
            ),
            ReportIdentityCollision.CONFLICTING_METADATA,
        )
        self.assertIs(
            index.record(
                report_id="report-2",
                report_document_id="document-1",
                metadata=first_metadata,
            ),
            ReportIdentityCollision.REUSED_DOCUMENT_ID,
        )


if __name__ == "__main__":
    unittest.main()
