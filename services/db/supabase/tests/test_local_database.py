"""Unit tests for local database URL and schema guards."""

import unittest
from collections.abc import Sequence
from typing import Self, cast

import psycopg

from services.db.supabase.tests.local_database import (
    LATEST_REQUIRED_MIGRATION,
    UnsafeDatabaseUrlError,
    assert_migrated_local_schema,
    require_local_supabase_url,
)


class _FakeSchemaConnection:
    def __init__(self, rows: Sequence[tuple[object, ...] | None]) -> None:
        self._rows = iter(rows)
        self.execute_calls: list[tuple[str, dict[str, object]]] = []

    def execute(
        self,
        query: str,
        params: dict[str, object] | None = None,
    ) -> Self:
        self.execute_calls.append((query, params or {}))
        return self

    def fetchone(self) -> tuple[object, ...] | None:
        return next(self._rows)


def _as_psycopg_connection(
    connection: _FakeSchemaConnection,
) -> psycopg.Connection[tuple[object, ...]]:
    return cast(psycopg.Connection[tuple[object, ...]], connection)


class LocalDatabaseUrlTests(unittest.TestCase):
    def assert_rejected(self, *database_urls: str) -> None:
        for database_url in database_urls:
            with self.subTest(database_url=database_url), self.assertRaises(UnsafeDatabaseUrlError):
                require_local_supabase_url(database_url)

    def test_malformed_database_url_is_rejected(self) -> None:
        self.assert_rejected(
            "",
            "postgresql://postgres:postgres@127.0.0.1:not-a-port/postgres",
            "postgresql://postgres:postgres@[::1/postgres",
            " postgresql://postgres:postgres@127.0.0.1:54322/postgres",
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres ",
        )

    def test_nonlocal_or_unexpected_database_url_is_rejected(self) -> None:
        self.assert_rejected(
            "postgresql://postgres:postgres@db.example.test:54322/postgres",
            "postgresql://postgres:postgres@127.0.0.1:54322/other",
            "postgresql://other:postgres@127.0.0.1:54322/postgres",
            "postgres://postgres:postgres@127.0.0.1:54322/postgres",
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=require",
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres#fragment",
        )

    def test_missing_or_unexpected_port_is_rejected(self) -> None:
        self.assert_rejected(
            "postgresql://postgres:postgres@127.0.0.1/postgres",
            "postgresql://postgres:postgres@127.0.0.1:0/postgres",
            "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
            "postgresql://postgres:postgres@127.0.0.1:55432/postgres",
            "postgresql://postgres:postgres@127.0.0.1:65536/postgres",
        )

    def test_expected_local_database_url_is_accepted(self) -> None:
        for database_url in (
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
            "postgresql://postgres:postgres@localhost:54322/postgres",
            "postgresql://postgres:postgres@[::1]:54322/postgres",
        ):
            with self.subTest(database_url=database_url):
                require_local_supabase_url(database_url)


class LocalDatabaseSchemaTests(unittest.TestCase):
    def test_current_schema_is_accepted(self) -> None:
        connection = _FakeSchemaConnection([(True, True, True, True), (True,) * 7])

        assert_migrated_local_schema(_as_psycopg_connection(connection))

        self.assertEqual(
            connection.execute_calls[1][1]["required_version"],
            LATEST_REQUIRED_MIGRATION,
        )

    def test_wrong_or_incomplete_project_is_rejected(self) -> None:
        for rows in (
            [(False, True, True, True)],
            [(True, True, True, False)],
            [(True, True, True, True), (False,) + (True,) * 6],
            [(True, True, True, True), (True,) * 2 + (False,) + (True,) * 4],
            [(True, True, True, True), (True,) * 4 + (False,) + (True,) * 2],
            [(True, True, True, True), (True,) * 6 + (False,)],
            [(True, True, True, True), (True,) * 6],
        ):
            with self.subTest(rows=rows), self.assertRaises(UnsafeDatabaseUrlError):
                assert_migrated_local_schema(_as_psycopg_connection(_FakeSchemaConnection(rows)))


if __name__ == "__main__":
    unittest.main()
