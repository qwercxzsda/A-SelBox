"""Import source evidence from a local seed into an isolated verification database.

Only COPY data for the source model is imported. SQL from the dump is never
executed, and Auth credentials and profile metadata are deliberately omitted.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any, LiteralString, TextIO

import psycopg
from psycopg import sql

Connection = psycopg.Connection[tuple[Any, ...]]

SOURCE_TABLES = frozenset(
    {
        "private.data_kiosk_acquisitions",
        "private.data_kiosk_days",
        "private.data_kiosk_preprocess_batches",
        "private.data_kiosk_preprocess_versions",
        "private.data_kiosk_pruned_versions",
        "private.data_kiosk_transactions",
        "private.settlement_acquisitions",
        "private.settlements",
        "private.settlement_preprocess_versions",
        "private.settlement_transactions",
        "public.companies",
        "public.skus",
        "public.sku_terms_versions",
        "public.app_accounts",
        "public.sku_fee_periods",
    }
)
COPY_HEADER = re.compile(r"COPY ([a-z_]+)\.([a-z_]+) \(([a-z0-9_, ]+)\) FROM stdin;\n?")


def _copy_lines(source: TextIO) -> Iterator[str]:
    """Consume a COPY body without interpreting private cells as SQL headers."""
    for line in source:
        if line.rstrip("\r\n") == "\\.":
            return
        yield line
    raise ValueError("The seed contains an unterminated COPY block")


def _copy_header(line: str) -> tuple[str, str, tuple[str, ...]]:
    match = COPY_HEADER.fullmatch(line)
    if match is None:
        raise ValueError("The seed contains an unsupported COPY header")
    schema, table, fields = match.groups()
    return schema, table, tuple(column.strip() for column in fields.split(","))


def _validate_seed_schema(connection: Connection, seed: Path) -> None:
    """Reject obsolete or mismatched dump shapes before starting any COPY."""
    expected: dict[str, set[str]] = {}
    for schema, table, column in connection.execute(
        "select table_schema,table_name,column_name from information_schema.columns "
        "where table_schema || '.' || table_name = any(%s::text[])",
        (sorted(SOURCE_TABLES),),
    ).fetchall():
        expected.setdefault(schema + "." + table, set()).add(column)
    with seed.open(encoding="utf-8") as source:
        for line in source:
            if not line.startswith("COPY "):
                continue
            schema, table, columns = _copy_header(line)
            relation = schema + "." + table
            if relation == "public.seller_skus" or "seller_sku_id" in columns:
                raise ValueError(
                    "The seed uses retired namespace-based SKU ownership. Prepare a current-schema "
                    "seed with explicit ownership conflict handling before verification."
                )
            if relation in SOURCE_TABLES and (
                len(columns) != len(set(columns)) or set(columns) != expected.get(relation)
            ):
                raise ValueError(
                    "The seed's source/application columns do not match current migrations"
                )
            if relation == "auth.users" and (
                "id" not in columns or len(columns) != len(set(columns))
            ):
                raise ValueError("The seed's Auth COPY header must contain one identity column")
            for _ in _copy_lines(source):
                pass


def _copy_auth_identities(connection: Connection, source: TextIO, columns: tuple[str, ...]) -> None:
    """Import only account foreign-key IDs; never send login/profile cells to COPY."""
    index = columns.index("id")
    with connection.cursor().copy("copy auth.users(id) from stdin") as copier:
        for row in _copy_lines(source):
            values = row.rstrip("\r\n").split("\t")
            if len(values) != len(columns):
                raise ValueError("The seed contains a malformed Auth COPY row")
            copier.write(values[index] + "\n")


def _copy_source_rows(
    connection: Connection, source: TextIO, schema: str, table: str, columns: tuple[str, ...]
) -> int:
    statement = sql.SQL("copy {} ({}) from stdin").format(
        sql.Identifier(schema, table),
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
    )
    count = 0
    with connection.cursor().copy(statement) as copier:
        for row in _copy_lines(source):
            copier.write(row)
            count += 1
    return count


def load_real_source_seed(connection: Connection, seed: Path) -> dict[str, object]:
    """Load current-source inputs into a disposable database without any credentials."""
    database = str(connection.execute("select current_database()").fetchall()[0][0])
    if not database.startswith("aselbox_test_"):
        raise ValueError("Real-seed verification requires a disposable test database")
    _validate_seed_schema(connection, seed)
    with seed.open("rb") as source:
        fingerprint = hashlib.file_digest(source, "sha256").hexdigest()
    counts: dict[str, int] = {}
    try:
        with connection.transaction():
            # Restore complete inventories together, then re-enable publication guards.
            connection.execute("set local session_replication_role = replica")
            with seed.open(encoding="utf-8") as source:
                for line in source:
                    if not line.startswith("COPY "):
                        continue
                    schema, table, columns = _copy_header(line)
                    relation = schema + "." + table
                    if relation == "auth.users":
                        _copy_auth_identities(connection, source, columns)
                    elif relation in SOURCE_TABLES:
                        count = _copy_source_rows(connection, source, schema, table, columns)
                        counts[relation] = counts.get(relation, 0) + count
                    else:
                        for _ in _copy_lines(source):
                            pass
            connection.execute("set local session_replication_role = origin")
            connection.execute("set constraints all immediate")
            connection.execute("set constraints all deferred")
    except psycopg.Error as error:
        # PostgreSQL COPY diagnostics may quote entire rows, including credentials.
        # The transaction context rolls back first; suppress the original traceback.
        raise ValueError(f"Seed COPY import failed (SQLSTATE {error.sqlstate})") from None
    return {"seed_sha256": fingerprint, "source_rows": counts}


def require(condition: bool, message: str) -> None:
    """Keep verification diagnostics free of source rows and account identifiers."""
    if not condition:
        raise AssertionError(message)


def as_user(
    connection: Connection,
    user: str,
    query: LiteralString,
    parameters: Sequence[object] = (),
) -> list[tuple[Any, ...]]:
    with connection.transaction():
        connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
        connection.execute("set local role authenticated")
        result = connection.execute(query, parameters).fetchall()
        connection.execute("reset role")
        return result


def source_versions(connection: Connection) -> dict[str, list[str]]:
    return {
        table: [
            str(row[0])
            for row in connection.execute(
                sql.SQL("select distinct version_id from private.{}").format(sql.Identifier(table))
            ).fetchall()
        ]
        for table in ("settlement_transactions", "data_kiosk_transactions")
    }


def source_fingerprints(connection: Connection, versions: dict[str, list[str]]) -> dict[str, str]:
    """Fingerprint complete financial rows so policy tests cannot alter their categories."""
    return {
        table: connection.execute(
            sql.SQL(
                "select md5(string_agg(md5(row_to_json(t)::text),'' order by id)) "
                "from private.{} t where version_id=any(%s::uuid[])"
            ).format(sql.Identifier(table)),
            (versions[table],),
        ).fetchall()[0][0]
        for table in ("settlement_transactions", "data_kiosk_transactions")
    }
