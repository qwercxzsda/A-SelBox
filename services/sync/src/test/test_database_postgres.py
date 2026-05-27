import logging
import unittest
from collections.abc import Iterable, Mapping
from pprint import pformat
from uuid import uuid4

from psycopg.rows import dict_row
from src.amazon.models import (
    ParsedSettlement,
    ParsedSettlementReport,
    ParsedSettlementTransaction,
)
from src.database import (
    LOCAL_SUPABASE_URL,
    PostgresDatabaseConnection,
    insert_settlement_report,
)

logger: logging.Logger = logging.getLogger(__name__)

SETTLEMENT_PRINT_SQL: str = """
    select *
    from private.settlements
    order by created_at, id
"""

TRANSACTION_PRINT_SQL: str = """
    select *
    from private.settlement_transactions
    where settlement_id = %s
    order by amz_report_line_no
"""


def remove_none_values(
    rows: Iterable[Mapping[str, object]],
) -> list[dict[str, object]]:
    """Return database rows without columns whose values are None."""
    return [{column: value for column, value in row.items() if value is not None} for row in rows]


def make_postgres_settlement_report() -> ParsedSettlementReport:
    """Build a unique parsed report for the real Postgres insertion test."""
    # Unique Amazon IDs keep the real database test isolated across repeated runs.
    unique_id: str = uuid4().hex

    return ParsedSettlementReport(
        settlement=ParsedSettlement(
            amz_region="NA",
            amz_settlement_id=f"test-settlement-{unique_id}",
            amz_document_id=f"test-document-{unique_id}",
            amz_settlement_start_date="15.04.2026 06:33:36 UTC",
            amz_settlement_end_date="29.04.2026 06:33:37 UTC",
            amz_deposit_date="01.05.2026 06:33:37 UTC",
            amz_total_amount="-58.54",
            amz_currency="CAD",
        ),
        transactions=[
            ParsedSettlementTransaction(
                amz_report_line_no=3,
                amz_transaction_type="other-transaction",
                amz_order_id=None,
                amz_merchant_order_id=None,
                amz_adjustment_id=None,
                amz_shipment_id=None,
                amz_marketplace_name=None,
                amz_amount_type="other-transaction",
                amz_amount_description="Payable to Amazon",
                amz_amount="-14.39",
                amz_fulfillment_id=None,
                amz_posted_date="15.04.2026",
                amz_posted_date_time="15.04.2026 06:33:36 UTC",
                amz_order_item_code=None,
                amz_merchant_order_item_id=None,
                amz_merchant_adjustment_item_id=None,
                amz_sku=None,
                amz_quantity_purchased=None,
                amz_promotion_id=None,
            )
        ],
    )


class TestPostgresSettlementInsert(unittest.TestCase):
    def _delete_inserted_settlement(
        self,
        database: PostgresDatabaseConnection,
        settlement_id: str | None,
    ) -> None:
        """Remove rows created by a Postgres integration test."""
        if settlement_id is None:
            return

        with database.connection() as conn, conn.transaction(), conn.cursor() as cursor:
            cursor.execute(
                """
                delete from private.settlement_transactions
                where settlement_id = %s
                """,
                (settlement_id,),
            )
            cursor.execute(
                """
                delete from private.settlements
                where id = %s
                """,
                (settlement_id,),
            )

    def test_insert_settlement_report_uses_real_local_postgres(self) -> None:
        """Verify settlement insertion and duplicate handling against local Postgres."""
        parsed_report: ParsedSettlementReport = make_postgres_settlement_report()
        settlement_id: str | None = None

        with PostgresDatabaseConnection(LOCAL_SUPABASE_URL) as database:
            try:
                settlement_id = insert_settlement_report(database, parsed_report)
                self.assertIsNotNone(settlement_id)

                with database.connection() as conn, conn.cursor(row_factory=dict_row) as cursor:
                    cursor.execute(
                        """
                        select amz_settlement_id, amz_document_id
                        from private.settlements
                        where id = %s
                        """,
                        (settlement_id,),
                    )
                    settlement_row = cursor.fetchone()
                    self.assertEqual(
                        settlement_row["amz_settlement_id"],
                        parsed_report.settlement.amz_settlement_id,
                    )
                    self.assertEqual(
                        settlement_row["amz_document_id"],
                        parsed_report.settlement.amz_document_id,
                    )

                    cursor.execute(
                        """
                        select count(*)
                        from private.settlement_transactions
                        where settlement_id = %s
                        """,
                        (settlement_id,),
                    )
                    transaction_count = cursor.fetchone()["count"]
                    self.assertEqual(transaction_count, len(parsed_report.transactions))

                duplicate_settlement_id = insert_settlement_report(database, parsed_report)
                self.assertIsNone(duplicate_settlement_id)

                with database.connection() as conn, conn.cursor(row_factory=dict_row) as cursor:
                    cursor.execute(
                        """
                        select count(*)
                        from private.settlement_transactions
                        where settlement_id = %s
                        """,
                        (settlement_id,),
                    )
                    transaction_count = cursor.fetchone()["count"]
                    self.assertEqual(transaction_count, len(parsed_report.transactions))
            finally:
                # Keep the local Supabase database clean even if assertions fail.
                self._delete_inserted_settlement(database, settlement_id)

    def test_log_database_tables_after_insert(self) -> None:
        """Log inserted settlement and transaction table rows for debugging."""
        parsed_report: ParsedSettlementReport = make_postgres_settlement_report()
        settlement_id: str | None = None

        with PostgresDatabaseConnection(LOCAL_SUPABASE_URL) as database:
            try:
                settlement_id = insert_settlement_report(database, parsed_report)
                self.assertIsNotNone(settlement_id)

                with database.connection() as conn, conn.cursor(row_factory=dict_row) as cursor:
                    cursor.execute(SETTLEMENT_PRINT_SQL)
                    settlement_rows = cursor.fetchall()

                    cursor.execute(TRANSACTION_PRINT_SQL, (settlement_id,))
                    transaction_rows = cursor.fetchall()

                logger.info(
                    "Whole private.settlements table after insert:\n%s",
                    pformat(remove_none_values(settlement_rows)),
                )
                logger.info(
                    "private.settlement_transactions rows after insert:\n%s",
                    pformat(remove_none_values(transaction_rows)),
                )

                self.assertTrue(
                    any(str(row["id"]) == settlement_id for row in settlement_rows),
                )
                self.assertEqual(len(transaction_rows), len(parsed_report.transactions))
            finally:
                self._delete_inserted_settlement(database, settlement_id)


if __name__ == "__main__":
    logging.basicConfig(
        format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s -- %(message)s",
        datefmt="%m/%d/%Y %H:%M:%S",
        level=logging.DEBUG,
    )
    unittest.main()
