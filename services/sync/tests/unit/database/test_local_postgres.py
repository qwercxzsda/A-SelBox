"""Tests for the loopback-only guard used by live integration workflows."""

import unittest

from ....src.database.local_postgres import validate_local_postgres_database_url


class TestPostgresIntegrationTargetGuard(unittest.TestCase):
    def test_accepts_explicit_loopback_postgres_database(self) -> None:
        database_url = "postgresql://postgres:postgres@127.0.0.1:55432/postgres"

        self.assertEqual(validate_local_postgres_database_url(database_url), database_url)

    def test_rejects_remote_database(self) -> None:
        with self.assertRaisesRegex(ValueError, "loopback"):
            validate_local_postgres_database_url(
                "postgresql://postgres:postgres@example.com:5432/postgres"
            )


if __name__ == "__main__":
    unittest.main()
