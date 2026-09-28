"""Isolated database fixtures and transaction adapters for integration tests."""

import unittest
from contextlib import AbstractContextManager, nullcontext
from datetime import date
from types import TracebackType
from typing import Self, cast

import psycopg
from psycopg import sql

from services.db.supabase.tests.isolated_database import isolated_database
from services.db.supabase.tests.local_database import require_row
from services.sync.src.database.connection import DatabaseConnection


class DatabaseTestCase(unittest.TestCase):
    """Install the baseline in a fresh disposable DB for each independent test."""

    def setUp(self) -> None:
        database_url = self.enterContext(isolated_database())
        self.connection = self.enterContext(psycopg.connect(database_url))
        self.addCleanup(self.connection.rollback)

    def set_mature_cutoff_date(self, mature_cutoff_date: date) -> None:
        """Keep dated archive fixtures in their intended authority period."""
        self.connection.execute(
            sql.SQL(
                "create or replace function private.mature_cutoff_date() "
                "returns date language sql stable parallel safe security invoker "
                "set search_path = '' as {}"
            ).format(sql.Literal(f"select date '{mature_cutoff_date.isoformat()}'"))
        )

    def mature_cutoff_date(self) -> date:
        """Read the fixture's current mature cutoff date."""
        return cast(
            date,
            require_row(self.connection.execute("select private.mature_cutoff_date()").fetchone())[
                0
            ],
        )


class TransactionDatabase(DatabaseConnection):
    """Reuse the fixture connection for repository transactions and savepoints."""

    def __init__(self, connection: psycopg.Connection[tuple[object, ...]]) -> None:
        self._connection = connection

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None

    def connection(self) -> AbstractContextManager[psycopg.Connection[tuple[object, ...]]]:
        return nullcontext(self._connection)
