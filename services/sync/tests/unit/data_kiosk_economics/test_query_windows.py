"""Tests for the rolling provision query window."""

import unittest
from datetime import UTC, date, datetime

from ....src.data_kiosk_economics.query_windows import default_query_window, resolve_query_window


class TestDefaultQueryWindow(unittest.TestCase):
    def test_contains_sixty_complete_days(self) -> None:
        start_date, end_date = default_query_window(marketplace_today=date(2026, 8, 25))

        self.assertEqual(start_date, date(2026, 6, 26))
        self.assertEqual(end_date, date(2026, 8, 24))
        self.assertEqual((end_date - start_date).days + 1, 60)

    def test_supports_an_explicit_positive_refresh_length(self) -> None:
        self.assertEqual(
            default_query_window(
                marketplace_today=date(2026, 8, 25),
                refresh_days=2,
            ),
            (date(2026, 8, 23), date(2026, 8, 24)),
        )

    def test_rejects_boolean_and_nonpositive_lengths(self) -> None:
        for value in (True, 0, -1):
            with self.subTest(value=value), self.assertRaises(ValueError):
                default_query_window(
                    marketplace_today=date(2026, 8, 25),
                    refresh_days=value,
                )


class TestResolveQueryWindow(unittest.TestCase):
    def test_default_window_uses_marketplace_local_yesterday(self) -> None:
        # UTC is already September 2, while the US marketplace is still September 1.
        window = resolve_query_window(
            "ATVPDKIKX0DER",
            explicit_window=None,
            refresh_days=2,
            resolved_at=datetime(2026, 9, 2, 1, tzinfo=UTC),
        )

        self.assertEqual(
            (window.start_date, window.end_date), (date(2026, 8, 30), date(2026, 8, 31))
        )

    def test_two_year_boundary_clamps_leap_day(self) -> None:
        window = resolve_query_window(
            "ATVPDKIKX0DER",
            explicit_window=(date(2022, 2, 28), date(2024, 2, 28)),
            refresh_days=60,
            resolved_at=datetime(2024, 2, 29, 12, tzinfo=UTC),
        )

        self.assertEqual(window.start_date, date(2022, 2, 28))

    def test_rejects_incomplete_expired_and_inverted_intervals(self) -> None:
        for start, end in (
            (date(2026, 9, 1), date(2026, 9, 2)),
            (date(2024, 9, 1), date(2026, 9, 1)),
            (date(2026, 9, 1), date(2026, 8, 31)),
        ):
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                resolve_query_window(
                    "ATVPDKIKX0DER",
                    explicit_window=(start, end),
                    refresh_days=60,
                    resolved_at=datetime(2026, 9, 2, 12, tzinfo=UTC),
                )

    def test_rejects_naive_resolution_time(self) -> None:
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            resolve_query_window(
                "ATVPDKIKX0DER",
                explicit_window=None,
                refresh_days=60,
                resolved_at=datetime(2026, 9, 2, 12),  # noqa: DTZ001
            )


if __name__ == "__main__":
    unittest.main()
