"""Reusable in-memory database test doubles."""

from collections.abc import Iterable
from contextlib import AbstractContextManager, nullcontext
from types import TracebackType
from typing import Self

from ...src.database.connection import DatabaseConnection


class FakeCursor:
    def __init__(
        self,
        fetchone_results: list[tuple[object, ...] | None],
        fetchall_results: list[list[tuple[object, ...]]] | None = None,
    ) -> None:
        """Create a fake cursor with queued fetchone results."""
        self.fetchone_results = list(fetchone_results)
        self.fetchall_results = list(fetchall_results or [])
        self.execute_calls: list[tuple[str, dict[str, object]]] = []
        self.executemany_calls: list[tuple[str, list[dict[str, object]]]] = []

    def __enter__(self) -> Self:
        """Enter the fake cursor context manager."""
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        """Do not suppress exceptions raised inside cursor usage."""
        return False

    def execute(self, sql: str, params: dict[str, object] | None = None) -> None:
        """Record a SQL execute call and its parameters."""
        self.execute_calls.append((sql, params or {}))

    def fetchone(self) -> tuple[object, ...] | None:
        """Return the next queued row from the fake cursor."""
        if not self.fetchone_results:
            return None
        return self.fetchone_results.pop(0)

    def fetchall(self) -> list[tuple[object, ...]]:
        """Return all remaining queued rows from the fake cursor."""
        if self.fetchall_results:
            return self.fetchall_results.pop(0)
        rows = [row for row in self.fetchone_results if row is not None]
        self.fetchone_results.clear()
        return rows

    def executemany(self, sql: str, params_seq: Iterable[dict[str, object]]) -> None:
        """Record a batched SQL execution and materialize its params."""
        self.executemany_calls.append((sql, list(params_seq)))


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        """Create a fake connection that returns one fake cursor."""
        self.cursor_obj = cursor
        self.transaction_count = 0

    def __enter__(self) -> Self:
        """Enter the fake connection context manager."""
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        """Do not suppress exceptions raised inside connection usage."""
        return False

    def transaction(self) -> AbstractContextManager[None]:
        """Return a no-op transaction context manager."""
        self.transaction_count += 1
        return nullcontext()

    def cursor(self) -> FakeCursor:
        """Return the fake cursor context manager."""
        return self.cursor_obj


class FakeDatabaseConnection(DatabaseConnection):
    def __init__(
        self,
        fetchone_results: list[tuple[object, ...] | None] | None = None,
        *,
        fetchall_results: list[list[tuple[object, ...]]] | None = None,
    ) -> None:
        """Create a fake database pool that returns one fake connection."""
        self.cursor_obj = FakeCursor(fetchone_results or [], fetchall_results)
        self.connection_obj = FakeConnection(self.cursor_obj)
        self.enter_count = 0
        self.connection_count = 0

    def __enter__(self) -> Self:
        """Enter the fake database pool context manager."""
        self.enter_count += 1
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        """Do not suppress exceptions raised inside database pool usage."""
        return False

    def connection(self) -> FakeConnection:
        """Return the fake connection context manager."""
        self.connection_count += 1
        return self.connection_obj

    @property
    def execute_calls(self) -> list[tuple[str, dict[str, object]]]:
        """Return execute calls recorded by the fake cursor."""
        return self.cursor_obj.execute_calls

    @property
    def executemany_calls(self) -> list[tuple[str, list[dict[str, object]]]]:
        """Return executemany calls recorded by the fake cursor."""
        return self.cursor_obj.executemany_calls
