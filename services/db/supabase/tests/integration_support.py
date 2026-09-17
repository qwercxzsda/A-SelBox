"""Isolated database fixtures and transaction adapters for integration tests."""

import unittest
from contextlib import AbstractContextManager, nullcontext
from types import TracebackType
from typing import Self

import psycopg

from services.db.supabase.tests.isolated_database import isolated_database
from services.sync.src.database.connection import DatabaseConnection


class DatabaseTestCase(unittest.TestCase):
    """Install the baseline in a fresh disposable DB for each independent test."""

    def setUp(self) -> None:
        database_url = self.enterContext(isolated_database())
        self.connection = self.enterContext(psycopg.connect(database_url))
        self.addCleanup(self.connection.rollback)


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
