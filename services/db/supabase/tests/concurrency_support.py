"""Observe real lock waits within one disposable test database."""

from time import monotonic, sleep

import psycopg

from services.db.supabase.tests.local_database import require_row


def wait_for_block(
    connection: psycopg.Connection, application_name: str, *, wait_event: str | None = None
) -> None:
    """Require evidence that the named worker reached a database lock wait."""
    deadline = monotonic() + 5
    while monotonic() < deadline:
        waiting = require_row(
            connection.execute(
                "select exists(select 1 from pg_stat_activity "
                "where datname=current_database() and application_name=%s "
                "and cardinality(pg_blocking_pids(pid))>0 "
                "and (%s::text is null or wait_event=%s))",
                (application_name, wait_event, wait_event),
            ).fetchone()
        )[0]
        if waiting:
            return
        sleep(0.02)
    raise TimeoutError(f"{application_name} did not reach the expected database lock wait.")
