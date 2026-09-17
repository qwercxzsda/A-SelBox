"""Tests for exact database arguments and canonical identifiers."""

import unittest
from datetime import UTC, date, datetime
from uuid import UUID

from ....src.database.values import normalize_uuid, required_date, required_text


class TestDatabaseValues(unittest.TestCase):
    def test_date_arguments_reject_timestamps(self) -> None:
        expected_date = date(2026, 8, 29)
        self.assertIs(required_date(expected_date, "activity_date"), expected_date)
        with self.assertRaises(RuntimeError):
            required_date(datetime(2026, 8, 29, tzinfo=UTC), "activity_date")

    def test_normalizes_uuid_objects_and_text(self) -> None:
        expected = "00000000-0000-0000-0000-000000000001"
        self.assertEqual(normalize_uuid(UUID(int=1), "version_id"), expected)
        self.assertEqual(normalize_uuid(f" {expected.upper()} ", "version_id"), expected)

    def test_rejects_non_uuid_values(self) -> None:
        for value in (None, 1, "not-a-uuid"):
            with self.subTest(value=value), self.assertRaises((TypeError, ValueError)):
                normalize_uuid(value, "version_id")

    def test_required_text_normalizes_nonblank_arguments(self) -> None:
        self.assertEqual(required_text(" company ", "name"), "company")
        for value in (None, 1, "", " "):
            with self.subTest(value=value), self.assertRaises(ValueError):
                required_text(value, "name")


if __name__ == "__main__":
    unittest.main()
