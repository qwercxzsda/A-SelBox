"""The database owns the currency precision used by every preprocessing."""

from collections.abc import Mapping
from decimal import Decimal

from ..database.connection import DatabaseConnection


def load_currency_decimals(database: DatabaseConnection) -> dict[str, int]:
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute("select code, decimals from private.currencies")
        return dict(cursor.fetchall())


def currency_unit(currency: str, decimals: Mapping[str, int]) -> Decimal:
    if currency not in decimals:
        raise ValueError("Currency is absent from the currency registry.")
    return Decimal(1).scaleb(-decimals[currency])
