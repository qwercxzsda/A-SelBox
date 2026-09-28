"""Import source evidence from a local seed into an isolated verification database.

Only COPY data for the source model is imported. SQL from the dump is never
executed, and Auth passwords, identities, and metadata are deliberately omitted.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Sequence
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
        "public.seller_skus",
        "public.sku_terms_versions",
        "public.app_accounts",
        "public.sku_fee_periods",
    }
)
COPY_HEADER = re.compile(r"COPY ([a-z_]+)\.([a-z_]+) \(([a-z0-9_, ]+)\) FROM stdin;\n?")


def _copy_data(source: TextIO) -> list[str]:
    """Read one bounded COPY block; never include its ending command."""
    rows: list[str] = []
    for line in source:
        if line.rstrip("\r\n") == "\\.":
            return rows
        rows.append(line)
    raise ValueError("The seed contains an unterminated COPY block")


def load_real_source_seed(connection: Connection, seed: Path) -> dict[str, object]:
    """Load current-source inputs into a disposable database without any credentials."""
    database = str(connection.execute("select current_database()").fetchall()[0][0])
    if not database.startswith("aselbox_test_"):
        raise ValueError("Real-seed verification requires a disposable test database")
    with seed.open("rb") as source:
        fingerprint = hashlib.file_digest(source, "sha256").hexdigest()
    counts: dict[str, int] = {}
    with connection.transaction():
        # The original publication sequence is not present in a data-only dump.
        # Restore complete immutable inventories together, then enable all guards.
        connection.execute("set local session_replication_role = replica")
        with seed.open(encoding="utf-8") as source:
            for line in source:
                if not line.startswith("COPY "):
                    continue
                match = COPY_HEADER.fullmatch(line)
                if match is None:
                    raise ValueError("The seed contains an unsupported COPY header")
                schema, table, column_text = match.groups()
                relation = schema + "." + table
                columns = column_text.split(", ")
                rows = _copy_data(source)
                if relation == "auth.users":
                    # Preserve only account foreign-key identities. No real login
                    # material is needed for database-role authorization checks.
                    index = columns.index("id")
                    with connection.cursor().copy("copy auth.users(id) from stdin") as copier:
                        for row in rows:
                            copier.write(row.split("\t")[index] + "\n")
                elif relation in SOURCE_TABLES:
                    statement = sql.SQL("copy {} ({}) from stdin").format(
                        sql.Identifier(schema, table),
                        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
                    )
                    with connection.cursor().copy(statement) as copier:
                        for row in rows:
                            copier.write(row)
                    counts[relation] = len(rows)
        connection.execute("set local session_replication_role = origin")
        connection.execute("set constraints all immediate")
        connection.execute("set constraints all deferred")
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
