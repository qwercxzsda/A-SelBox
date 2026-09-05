"""Fail-closed validation for destructive workflows targeting local Postgres."""

from ipaddress import ip_address
from urllib.parse import SplitResult, urlsplit

_MAX_TCP_PORT = 65_535


def validate_local_postgres_database_url(database_url: str) -> str:
    """Accept only an explicit loopback postgres-user/postgres-database URL."""
    if not database_url or database_url != database_url.strip():
        raise ValueError("Pass an explicit local PostgreSQL database URL.")
    try:
        parsed = urlsplit(database_url)
        port = parsed.port
    except ValueError as error:
        raise ValueError("Pass a valid local PostgreSQL database URL.") from error

    if not _is_safe_local_database_target(parsed, port):
        raise ValueError(
            "Only an explicit loopback postgres-user/postgres-database URL is allowed."
        )
    return database_url


def _is_safe_local_database_target(parsed: SplitResult, port: int | None) -> bool:
    if (
        parsed.scheme != "postgresql"
        or parsed.username != "postgres"
        or parsed.hostname is None
        or port is None
        or not 1 <= port <= _MAX_TCP_PORT
        or parsed.path != "/postgres"
        or parsed.query
        or parsed.fragment
    ):
        return False
    if parsed.hostname.casefold() == "localhost":
        return True
    try:
        return ip_address(parsed.hostname).is_loopback
    except ValueError:
        return False


__all__ = ["validate_local_postgres_database_url"]
