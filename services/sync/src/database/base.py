from abc import ABC, abstractmethod
from contextlib import AbstractContextManager
from dataclasses import asdict
from types import TracebackType
from typing import Any, Self

from src.amazon.models import ParsedSettlementReport

# Duplicate settlement reports return no row here, which also skips transaction inserts.
SETTLEMENT_INSERT_SQL: str = """
    insert into private.settlements (
        amz_region,
        amz_settlement_id,
        amz_document_id,
        amz_settlement_start_date,
        amz_settlement_end_date,
        amz_deposit_date,
        amz_total_amount,
        amz_currency
    )
    values (
        %(amz_region)s,
        %(amz_settlement_id)s,
        %(amz_document_id)s,
        %(amz_settlement_start_date)s,
        %(amz_settlement_end_date)s,
        %(amz_deposit_date)s,
        %(amz_total_amount)s,
        %(amz_currency)s
    )
    on conflict do nothing
    returning id
"""

TRANSACTION_INSERT_SQL: str = """
    insert into private.settlement_transactions (
        settlement_id,
        amz_report_line_no,
        amz_transaction_type,
        amz_order_id,
        amz_merchant_order_id,
        amz_adjustment_id,
        amz_shipment_id,
        amz_marketplace_name,
        amz_amount_type,
        amz_amount_description,
        amz_amount,
        amz_fulfillment_id,
        amz_posted_date,
        amz_posted_date_time,
        amz_order_item_code,
        amz_merchant_order_item_id,
        amz_merchant_adjustment_item_id,
        amz_sku,
        amz_quantity_purchased,
        amz_promotion_id
    )
    values (
        %(settlement_id)s,
        %(amz_report_line_no)s,
        %(amz_transaction_type)s,
        %(amz_order_id)s,
        %(amz_merchant_order_id)s,
        %(amz_adjustment_id)s,
        %(amz_shipment_id)s,
        %(amz_marketplace_name)s,
        %(amz_amount_type)s,
        %(amz_amount_description)s,
        %(amz_amount)s,
        %(amz_fulfillment_id)s,
        %(amz_posted_date)s,
        %(amz_posted_date_time)s,
        %(amz_order_item_code)s,
        %(amz_merchant_order_item_id)s,
        %(amz_merchant_adjustment_item_id)s,
        %(amz_sku)s,
        %(amz_quantity_purchased)s,
        %(amz_promotion_id)s
    )
"""


class DatabaseConnection(ABC):
    """Manage a database connection pool and provide connection contexts."""

    @abstractmethod
    def __enter__(self) -> Self:
        """Open or acquire a database connection for the current workflow."""

    @abstractmethod
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None:
        """Release the database connection without suppressing workflow errors."""

    @abstractmethod
    def connection(self) -> AbstractContextManager[Any]:
        """Return a context manager that yields one database connection."""


def get_transaction_rows(
    settlement_id: str,
    parsed_report: ParsedSettlementReport,
) -> list[dict[str, str | int | None]]:
    """Attach the inserted settlement ID to each parsed transaction row."""
    return [
        {
            "settlement_id": settlement_id,
            **asdict(transaction),
        }
        for transaction in parsed_report.transactions
    ]


def insert_settlement_report(
    database: DatabaseConnection,
    parsed_report: ParsedSettlementReport,
) -> str | None:
    """Insert a settlement and its transactions, skipping duplicate reports."""
    with database.connection() as conn, conn.transaction(), conn.cursor() as cursor:
        cursor.execute(SETTLEMENT_INSERT_SQL, asdict(parsed_report.settlement))
        inserted_row = cursor.fetchone()

        if inserted_row is None:
            return None

        settlement_id: str = str(inserted_row[0])
        # Transactions are inserted only after we have a newly created settlement ID.
        transaction_rows: list[dict[str, str | int | None]] = get_transaction_rows(
            settlement_id,
            parsed_report,
        )
        if transaction_rows:
            cursor.executemany(TRANSACTION_INSERT_SQL, transaction_rows)

        return settlement_id
