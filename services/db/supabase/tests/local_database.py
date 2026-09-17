"""Loopback target guards and SQL helpers for disposable database tests."""

from ipaddress import ip_address
from pathlib import Path
from typing import LiteralString, cast
from urllib.parse import urlsplit

from psycopg import sql

from services.sync.src.database.config import LOCAL_SUPABASE_URL

DEFAULT_DATABASE_URL = LOCAL_SUPABASE_URL
LOCAL_SUPABASE_PORT = urlsplit(LOCAL_SUPABASE_URL).port


class UnsafeDatabaseUrlError(ValueError):
    """The target is not this repository's local Supabase server."""


def require_local_supabase_url(database_url: str) -> None:
    """Reject remote, malformed, or unexpected database targets."""
    if not database_url or database_url != database_url.strip():
        raise UnsafeDatabaseUrlError("Pass an explicit local Supabase database URL.")
    try:
        target = urlsplit(database_url)
        port = target.port
    except ValueError as error:
        raise UnsafeDatabaseUrlError("Database tests require local Supabase Postgres.") from error
    if (
        target.scheme != "postgresql"
        or target.username != "postgres"
        or not _is_loopback_host(target.hostname)
        or port != LOCAL_SUPABASE_PORT
        or target.path != "/postgres"
        or target.query
        or target.fragment
    ):
        raise UnsafeDatabaseUrlError(
            "Database tests require the local Supabase database on port 54322."
        )


def _is_loopback_host(host: str | None) -> bool:
    """Accept a literal loopback IP or localhost, without resolving arbitrary DNS."""
    if host is None:
        return False
    if host.casefold() == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def read_trusted_sql(path: Path) -> sql.SQL:
    """Read only a repository-owned SQL fixture or migration."""
    return sql.SQL(cast(LiteralString, path.read_text(encoding="utf-8")))


def require_row[T](value: T | None) -> T:
    """Require the single database result expected by an integration fixture."""
    if value is None:
        raise AssertionError("Expected one database result.")
    return value
