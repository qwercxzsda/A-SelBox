"""Shared assertions, actor reads, and financial fingerprints for seed verification."""

from collections.abc import Sequence
from typing import Any, LiteralString

import psycopg
from psycopg import sql

Connection = psycopg.Connection[tuple[Any, ...]]


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


FACT_TABLES = (
    "finances_amounts",
    "ad_invoice_lines",
    "storage_rows",
    "aged_storage_rows",
    "removal_order_rows",
    "inventory_ledger_rows",
)


def source_versions(connection: Connection) -> dict[str, list[str]]:
    return {
        table: [
            str(row[0])
            for row in connection.execute(
                sql.SQL("select distinct version_id from private.{}").format(sql.Identifier(table))
            ).fetchall()
        ]
        for table in FACT_TABLES
    }


def source_fingerprints(connection: Connection, versions: dict[str, list[str]]) -> dict[str, str]:
    """Fingerprint complete financial rows so assignment changes cannot alter source facts."""
    return {
        table: connection.execute(
            sql.SQL(
                "select md5(string_agg(md5(row_to_json(t)::text),'' order by id)) "
                "from private.{} t where version_id=any(%s::uuid[])"
            ).format(sql.Identifier(table)),
            (versions[table],),
        ).fetchall()[0][0]
        for table in FACT_TABLES
    }
