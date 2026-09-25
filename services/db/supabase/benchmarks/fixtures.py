"""Guarded lifecycle for clone-only density and multi-year history fixtures."""

from __future__ import annotations

import os
from collections.abc import Generator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from psycopg import sql

from .common import (
    CONTAINER,
    Connection,
    catalog_fingerprint,
    connect,
    docker,
    source_connection,
)
from .density_fixture import build_density
from .history_fixture import build_history

FIXTURES = {"density": "aselbox_opt_large", "history": "aselbox_opt_broad"}


@dataclass
class Clones:
    source: Connection
    password: str
    dump: Path
    created: list[str] = field(default_factory=list[str])

    def build(self, fixture: str) -> tuple[str, dict[str, object]]:
        database = FIXTURES[fixture]
        self.source.execute(
            sql.SQL("create database {} template template0").format(sql.Identifier(database))
        )
        self.created.append(database)
        with self.dump.open("rb") as stream:
            docker(
                "exec",
                "-i",
                CONTAINER,
                "pg_restore",
                "-U",
                "supabase_admin",
                "-d",
                database,
                "--exit-on-error",
                stdin=stream,
            )
        with connect(database, self.password) as connection:
            initial = catalog_fingerprint(connection)
            if fixture == "density":
                metadata = build_density()
            else:
                metadata = build_history(connection, copies=10)
            if initial != catalog_fingerprint(connection):
                raise RuntimeError("Fixture setup changed schema or access rules")
            tables = connection.execute(
                "select schemaname,tablename from pg_tables "
                "where schemaname in ('public','private') order by 1,2"
            ).fetchall()
            for schema, table in tables:
                connection.execute(
                    sql.SQL("vacuum (analyze) {}.{}").format(
                        sql.Identifier(schema), sql.Identifier(table)
                    )
                )
        return database, metadata

    def remove(self) -> None:
        errors: list[str] = []
        for database in reversed(self.created):
            try:
                self.source.execute(
                    sql.SQL("drop database {} with (force)").format(sql.Identifier(database))
                )
            except Exception:
                errors.append(database)
        if errors:
            raise RuntimeError("Could not remove every owned benchmark clone")


def _source_state(connection: Connection) -> dict[str, str]:
    with connection.transaction():
        connection.execute("set transaction read only")
        return catalog_fingerprint(connection)


@contextmanager
def clone_session(
    selected: Sequence[str], password: str, temporary: Path, cleanup: dict[str, object]
) -> Generator[Clones]:
    if not selected or any(name not in FIXTURES for name in selected):
        raise ValueError("Choose allowlisted benchmark fixtures")
    names = [FIXTURES[name] for name in selected]
    with source_connection(password) as source:
        before = _source_state(source)
        existing = source.execute(
            "select datname from pg_database where datname=any(%s)", (names,)
        ).fetchall()
        if existing:
            raise RuntimeError("A benchmark clone already exists; refusing to reuse it")
        dump = temporary / "seed.private.dump"
        clones = Clones(source, password, dump)
        try:
            with os.fdopen(
                os.open(dump, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb"
            ) as stream:
                stream.write(
                    docker("exec", CONTAINER, "pg_dump", "-U", "postgres", "-d", "postgres", "-Fc")
                )
            yield clones
        finally:
            try:
                clones.remove()
            finally:
                dump.unlink(missing_ok=True)
                remaining = source.execute(
                    "select datname from pg_database where datname=any(%s)", (clones.created,)
                ).fetchall()
                unchanged = before == _source_state(source)
                cleanup.update(
                    {
                        "clones_created": len(clones.created),
                        "clones_removed": len(clones.created) - len(remaining),
                        "remaining_clones": len(remaining),
                        "source_catalog_unchanged": unchanged,
                        "private_dump_removed": not dump.exists(),
                    }
                )
                if not unchanged:
                    raise RuntimeError("Source catalog changed during the benchmark")
