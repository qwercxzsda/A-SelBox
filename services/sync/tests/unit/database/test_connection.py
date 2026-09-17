"""Tests for deterministic Postgres pool ownership."""

import unittest
from unittest.mock import MagicMock, patch

from ....src.database.connection import PostgresDatabaseConnection


class TestPostgresDatabaseConnection(unittest.TestCase):
    @patch("services.sync.src.database.connection.ConnectionPool")
    def test_closes_partially_opened_pool_when_open_fails(self, pool_type: MagicMock) -> None:
        pool = pool_type.return_value
        pool.open.side_effect = RuntimeError("connection failed")
        database = PostgresDatabaseConnection("postgresql://example.invalid/postgres")

        with self.assertRaisesRegex(RuntimeError, "connection failed"):
            database.__enter__()

        pool.close.assert_called_once_with()
        with self.assertRaisesRegex(RuntimeError, "must be used as a context manager"):
            database.connection()

    @patch("services.sync.src.database.connection.ConnectionPool")
    def test_rejects_reentry_and_releases_pool_once(self, pool_type: MagicMock) -> None:
        pool = pool_type.return_value
        database = PostgresDatabaseConnection("postgresql://example.invalid/postgres")

        with database, self.assertRaisesRegex(RuntimeError, "already open"):
            database.__enter__()

        pool.open.assert_called_once_with()
        pool.close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
