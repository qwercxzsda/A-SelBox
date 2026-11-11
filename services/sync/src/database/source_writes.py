"""Transaction primitives shared by trusted source repositories."""

from collections.abc import Sequence
from typing import Any, LiteralString

from psycopg import Cursor
from psycopg.errors import InvalidTransactionState


def require_read_committed(cursor: Cursor[dict[str, Any]]) -> None:
    cursor.execute("SELECT current_setting('transaction_isolation') AS isolation")
    row = cursor.fetchone()
    if row is None or row["isolation"] != "read committed":
        raise InvalidTransactionState("Source publication requires READ COMMITTED isolation.")


def copy_rows(
    cursor: Cursor[dict[str, Any]], statement: LiteralString, rows: Sequence[tuple[object, ...]]
) -> None:
    """Insert each complete child set as one statement for relational inventory guards."""
    if rows:
        with cursor.copy(statement) as copy:
            for row in rows:
                copy.write_row(row)
