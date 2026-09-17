import unittest
from datetime import UTC, datetime

from ....src.amazon.reports.summaries import parse_done_report_summary

REPORT_TYPE = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2"


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
    def test_preserves_supplied_marketplace_hint_order(self) -> None:
        summary = parse_done_report_summary(
            _done_report(),
            expected_report_types=(REPORT_TYPE,),
        )

        self.assertEqual(summary.report_id, "report-1")
        self.assertEqual(summary.report_document_id, "document-1")
        self.assertEqual(summary.created_at, datetime(2026, 8, 20, 3, tzinfo=UTC))
        self.assertEqual(summary.marketplace_ids, ("marketplace-2", "marketplace-1"))
        self.assertEqual(summary.api_metadata, _done_report())

    def test_optional_marketplace_hints_preserve_original_metadata(self) -> None:
        omitted = _done_report()
        del omitted["marketplaceIds"]
        reports: tuple[dict[str, object], ...] = (
            omitted,
            _done_report() | {"marketplaceIds": None},
            _done_report() | {"marketplaceIds": list[str]()},
        )
        for report in reports:
            with self.subTest(report=report):
                summary = parse_done_report_summary(
                    report,
                    expected_report_types=(REPORT_TYPE,),
                )
                self.assertEqual(summary.marketplace_ids, ())
                self.assertEqual(summary.api_metadata, report)

    def test_duplicate_marketplace_hints_are_preserved(self) -> None:
        summary = parse_done_report_summary(
            _done_report() | {"marketplaceIds": ["marketplace-1", "marketplace-1"]},
            expected_report_types=(REPORT_TYPE,),
        )

        self.assertEqual(summary.marketplace_ids, ("marketplace-1", "marketplace-1"))

    def test_hint_changes_do_not_change_report_identity(self) -> None:
        original = parse_done_report_summary(
            _done_report(),
            expected_report_types=(REPORT_TYPE,),
        )
        changed = parse_done_report_summary(
            _done_report()
            | {
                "marketplaceIds": ["other-marketplace"],
                "dataStartTime": "2026-07-01T00:00:00Z",
                "dataEndTime": None,
            },
            expected_report_types=(REPORT_TYPE,),
        )

        self.assertEqual(original, changed)
        self.assertNotEqual(original.api_metadata, changed.api_metadata)

    def test_rejects_malformed_or_conflicting_summary_fields(self) -> None:
        invalid_reports = (
            _done_report() | {"reportId": " report-1"},
            _done_report() | {"processingStatus": "IN_PROGRESS"},
            _done_report() | {"reportType": "UNEXPECTED"},
            _done_report() | {"createdTime": "2026-08-20T12:00:00"},
            _done_report() | {"marketplaceIds": "marketplace-1"},
            _done_report() | {"marketplaceIds": ["marketplace-1", None]},
            _done_report() | {"marketplaceIds": [" "]},
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
