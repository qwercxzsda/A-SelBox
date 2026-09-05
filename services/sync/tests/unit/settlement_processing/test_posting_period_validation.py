"""Settlement processing keeps postings within the header's date and time bounds."""

import unittest
from dataclasses import replace
from datetime import UTC, date, datetime
from uuid import uuid4

from ....src.settlement_processing.models import StoredSettlementReport, StoredSettlementRow
from ....src.settlement_processing.raw_report import prepare_settlement_report
from ...support.settlement_processing import stored_settlement_report


def _report_with_posting(
    posted_at: str,
    *,
    header_start: str = "2026-08-01T00:00:00Z",
    header_end: str = "2026-08-15T23:59:59Z",
) -> StoredSettlementReport:
    report = stored_settlement_report()
    metadata_overrides = {
        "settlement-start-date": header_start,
        "settlement-end-date": header_end,
    }
    rows: list[StoredSettlementRow] = []
    for row, timestamp in zip(report.rows, (header_start, posted_at), strict=True):
        overrides = {"posted-date": timestamp[:10], "posted-date-time": timestamp}
        rows.append(
            replace(
                row,
                values=tuple(
                    overrides.get(column, value)
                    for column, value in zip(report.columns, row.values, strict=True)
                ),
            )
        )
    return replace(
        report,
        metadata_values=tuple(
            metadata_overrides.get(column, value)
            for column, value in zip(report.columns, report.metadata_values, strict=True)
        ),
        rows=tuple(rows),
    )


class TestPostingPeriodValidation(unittest.TestCase):
    def test_timestamp_outside_header_period_identifies_source_line(self) -> None:
        for posted_at in (
            "2026-08-01T23:59:59Z",
            "2026-08-02T11:59:59.999999Z",
            "2026-08-02T13:00:00.000001Z",
            "2026-08-03T00:00:00Z",
        ):
            with self.subTest(posted_at=posted_at):
                report = _report_with_posting(
                    posted_at,
                    header_start="2026-08-02T12:00:00Z",
                    header_end="2026-08-02T13:00:00Z",
                )

                with self.assertRaisesRegex(
                    ValueError,
                    r"row 4 .*posted timestamp outside the Settlement header period",
                ):
                    prepare_settlement_report(report, id_factory=lambda: str(uuid4()))

    def test_exact_header_timestamp_boundaries_are_inclusive(self) -> None:
        for posted_at in ("2026-08-01T00:00:00Z", "2026-08-15T23:59:59Z"):
            with self.subTest(posted_at=posted_at):
                prepared = prepare_settlement_report(
                    _report_with_posting(posted_at),
                    id_factory=lambda: str(uuid4()),
                )

                self.assertEqual(
                    prepared.source_lines[1].posted_at,
                    datetime.fromisoformat(posted_at),
                )

    def test_equivalent_boundary_instants_accept_different_offsets(self) -> None:
        cases = (
            (
                "2026-08-01T01:00:00+10:00",
                datetime(2026, 7, 31, 15, tzinfo=UTC),
                date(2026, 8, 1),
            ),
            (
                "2026-08-15T09:00:00-05:00",
                datetime(2026, 8, 15, 14, tzinfo=UTC),
                date(2026, 8, 15),
            ),
        )
        for posted_at, expected_timestamp, expected_date in cases:
            with self.subTest(posted_at=posted_at):
                prepared = prepare_settlement_report(
                    _report_with_posting(
                        posted_at,
                        header_start="2026-08-01T00:00:00+09:00",
                        header_end="2026-08-15T23:00:00+09:00",
                    ),
                    id_factory=lambda: str(uuid4()),
                )

                self.assertEqual(prepared.source_lines[1].posted_at, expected_timestamp)
                self.assertEqual(prepared.source_lines[1].posted_date, expected_date)

    def test_in_range_instant_cannot_extend_acquisition_calendar_dates(self) -> None:
        for posted_at in (
            "2026-07-31T20:00:00-04:00",
            "2026-08-16T08:59:59+09:00",
        ):
            with (
                self.subTest(posted_at=posted_at),
                self.assertRaisesRegex(
                    ValueError,
                    r"row 4 .*posted date outside the Settlement header date window",
                ),
            ):
                prepare_settlement_report(
                    _report_with_posting(posted_at),
                    id_factory=lambda: str(uuid4()),
                )


if __name__ == "__main__":
    unittest.main()
