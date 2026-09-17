from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
from types import TracebackType
from typing import Any, Literal, Self

from psycopg_pool import ConnectionPool

from .config import DEFAULT_POOL_MIN_SIZE, DEFAULT_POOL_SIZE


class DatabaseConnection(ABC):
    """Manage a database connection pool and provide connection contexts."""

    @abstractmethod
    def __enter__(self) -> Self:
        """Open or acquire a database connection for the current workflow."""

    @abstractmethod
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None:
        """Release the database connection without suppressing workflow errors."""

    @abstractmethod
    def connection(self) -> AbstractContextManager[Any]:
        """Return a context manager that yields one database connection."""


class PostgresDatabaseConnection(DatabaseConnection):
    """Use a psycopg connection pool for service database workflows."""

    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        self._pool: ConnectionPool[Any] | None = None

    def __enter__(self) -> Self:
        if self._pool is not None:
            raise RuntimeError("PostgresDatabaseConnection is already open.")
        pool = ConnectionPool(
            conninfo=self.database_url,
            kwargs={"autocommit": True},
            min_size=DEFAULT_POOL_MIN_SIZE,
            max_size=DEFAULT_POOL_SIZE,
            open=False,
        )
        try:
            pool.open()
        except BaseException:
            pool.close()
            raise
        self._pool = pool
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> Literal[False]:
        pool = self._pool
        self._pool = None
        if pool is not None:
            pool.close()
        return False

    def connection(self) -> AbstractContextManager[Any]:
        if self._pool is None:
            raise RuntimeError("PostgresDatabaseConnection must be used as a context manager.")
        return self._pool.connection()


__all__ = ["DatabaseConnection", "PostgresDatabaseConnection"]
