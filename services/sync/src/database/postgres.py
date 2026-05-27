from contextlib import AbstractContextManager
from types import TracebackType
from typing import Any, Self

from psycopg_pool import ConnectionPool

from src.database.base import DatabaseConnection
from src.database.config import DEFAULT_POOL_MIN_SIZE, DEFAULT_POOL_SIZE


class PostgresDatabaseConnection(DatabaseConnection):
    """Use a psycopg connection pool to run settlement sync SQL against Postgres."""

    def __init__(self, database_url: str) -> None:
        """Store pool settings; the pool opens only when entering the context."""
        self.database_url = database_url
        self._pool: ConnectionPool[Any] | None = None

    def __enter__(self) -> Self:
        """Open the connection pool for the current workflow."""
        self._pool = ConnectionPool(
            conninfo=self.database_url,
            kwargs={"autocommit": True},
            min_size=DEFAULT_POOL_MIN_SIZE,
            max_size=DEFAULT_POOL_SIZE,
            open=False,
        )
        self._pool.open()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        """Close the connection pool without suppressing workflow errors."""
        if self._pool is not None:
            self._pool.close()
        self._pool = None

        return False

    def connection(self) -> AbstractContextManager[Any]:
        """Borrow one connection from the pool for a scoped unit of work."""
        if self._pool is None:
            raise RuntimeError("PostgresDatabaseConnection must be used as a context manager.")
        return self._pool.connection()
