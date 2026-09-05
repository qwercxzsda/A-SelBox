import unittest
from datetime import UTC, datetime

from ....src.amazon.fba_reports.report_types import FBA_AGED_STORAGE_FEE_REPORT
from ....src.amazon.reports.summaries import parse_done_report_summary

REPORT_TYPE = FBA_AGED_STORAGE_FEE_REPORT


def _done_report() -> dict[str, object]:
    return {
        "reportId": "report-1",
        "reportDocumentId": "document-1",
        "reportType": REPORT_TYPE,
        "processingStatus": "DONE",
        "createdTime": "2026-08-20T12:00:00+09:00",
        "dataStartTime": "2026-08-01T00:00:00Z",
        "dataEndTime": "2026-08-02T00:00:00Z",
        "marketplaceIds": ["marketplace-2", "marketplace-1"],
    }


class TestDoneReportSummary(unittest.TestCase):
    def test_parses_one_strict_normalized_identity(self) -> None:
        summary = parse_done_report_summary(
            _done_report(),
            expected_report_types=(REPORT_TYPE,),
        )

        self.assertEqual(summary.report_id, "report-1")
        self.assertEqual(summary.report_document_id, "document-1")
        self.assertEqual(summary.created_at, datetime(2026, 8, 20, 3, tzinfo=UTC))
        self.assertEqual(summary.marketplace_ids, ("marketplace-1", "marketplace-2"))

    def test_rejects_malformed_or_conflicting_summary_fields(self) -> None:
        invalid_reports = (
            _done_report() | {"reportId": " report-1"},
            _done_report() | {"processingStatus": "IN_PROGRESS"},
            _done_report() | {"reportType": "UNEXPECTED"},
            _done_report() | {"createdTime": "2026-08-20T12:00:00"},
            _done_report() | {"marketplaceIds": ["marketplace-1", "marketplace-1"]},
            _done_report()
            | {
                "dataStartTime": "2026-08-03T00:00:00Z",
                "dataEndTime": "2026-08-02T00:00:00Z",
            },
        )

        for report in invalid_reports:
            with self.subTest(report=report), self.assertRaises(ValueError):
                parse_done_report_summary(
                    report,
                    expected_report_types=(REPORT_TYPE,),
                )


if __name__ == "__main__":
    unittest.main()
