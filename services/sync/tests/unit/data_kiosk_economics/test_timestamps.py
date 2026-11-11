"""Reporting timestamps preserve local-day evidence across time zones and DST."""

import unittest
from datetime import UTC, date, datetime

from services.sync.src.data_kiosk_economics.timestamps import reporting_activity_at


class ReportingTimestampTests(unittest.TestCase):
    def test_last_microsecond_of_local_day_uses_next_midnight_offset(self) -> None:
        for market, day, expected in (
            ("Amazon.com", "2026-08-31", "2026-09-01T06:59:59.999999+00:00"),
            ("Amazon.co.jp", "2026-08-31", "2026-08-31T14:59:59.999999+00:00"),
            ("Amazon.com", "2026-03-08", "2026-03-09T06:59:59.999999+00:00"),
            ("Amazon.com", "2026-11-01", "2026-11-02T07:59:59.999999+00:00"),
            ("Amazon.de", "2026-03-29", "2026-03-29T21:59:59.999999+00:00"),
            ("Amazon.de", "2026-10-25", "2026-10-25T22:59:59.999999+00:00"),
            ("Amazon.com.au", "2026-04-05", "2026-04-05T13:59:59.999999+00:00"),
            ("Amazon.com.au", "2026-10-04", "2026-10-04T12:59:59.999999+00:00"),
        ):
            with self.subTest(market=market, day=day):
                actual = reporting_activity_at(date.fromisoformat(day), market)
                self.assertEqual(actual, datetime.fromisoformat(expected))
                self.assertIs(actual.tzinfo, UTC)

    def test_timestamp_requires_a_supported_retail_marketplace_and_calendar_date(self) -> None:
        for market in ("Unknown", "Non-Amazon US", "amazon.com"):
            with self.subTest(market=market), self.assertRaises(ValueError):
                reporting_activity_at(date(2026, 8, 31), market)
        with self.assertRaises(TypeError):
            reporting_activity_at(datetime(2026, 8, 31, tzinfo=UTC), "Amazon.com")
