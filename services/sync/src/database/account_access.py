"""DB-manager-only administration; no browser or service-role API key is accepted."""

from .connection import DatabaseConnection
from .values import normalize_uuid


def set_administrator_access(database: DatabaseConnection, *, user_id: str, enabled: bool) -> str:
    """Grant or revoke administrator access using a trusted PostgreSQL connection.

    Granting clears membership. Revoking an administrator makes the user
    Unassigned; revoking a non-administrator preserves their existing membership.
    The Auth identity and session remain intact. Existing tokens immediately follow
    the stored access role on their next database request.

    Returns the resulting internal role (administrator, member or unassigned).
    Unknown accounts fail without creating an Auth user or application account.
    """
    normalized_user_id = normalize_uuid(user_id, "user_id")
    if type(enabled) is not bool:
        raise TypeError("enabled must be a bool.")
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor() as cursor,
    ):
        cursor.execute(
            "select access_role::text from private.set_administrator_access("
            "%(user_id)s::uuid, %(enabled)s)",
            {"user_id": normalized_user_id, "enabled": enabled},
        )
        row = cursor.fetchone()
        if row is None or row[0] not in {"administrator", "member", "unassigned"}:
            raise RuntimeError("Administrator access update returned an invalid account.")
        return str(row[0])
