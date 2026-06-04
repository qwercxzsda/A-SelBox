import logging
import unittest
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import Decimal
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
    PreprocessResult,
    insert_settlement_report,
    preprocess_no_sku_transactions,
    preprocess_order_transactions,
)
from src.database.preprocess import ALL_MARKETPLACES, UNKNOWN_SKU

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

TEST_ORDER_PREPROCESS_VERSION: str = "test-order-v1"
TEST_NO_SKU_PREPROCESS_VERSION: str = "test-no-sku-v1"
TEST_PREPROCESS_DESCRIPTION: str = "postgres integration test"


@dataclass(frozen=True)
class ExtensivePreprocessFixture:
    report: ParsedSettlementReport
    sku_exact: str
    sku_all: str
    sku_no_fee: str
    sku_expired_fee: str


def remove_none_values(
    rows: Iterable[Mapping[str, object]],
) -> list[dict[str, object]]:
    """Return database rows without columns whose values are None."""
    return [{column: value for column, value in row.items() if value is not None} for row in rows]


def preprocess_order_then_no_sku(
    database: PostgresDatabaseConnection,
    settlement_id: str,
) -> list[PreprocessResult]:
    """Run Step B then Step C with explicit test metadata."""
    return [
        preprocess_order_transactions(
            database,
            settlement_id,
            preprocess_version=TEST_ORDER_PREPROCESS_VERSION,
            preprocess_description=TEST_PREPROCESS_DESCRIPTION,
        ),
        preprocess_no_sku_transactions(
            database,
            settlement_id,
            preprocess_version=TEST_NO_SKU_PREPROCESS_VERSION,
            preprocess_description=TEST_PREPROCESS_DESCRIPTION,
        ),
    ]


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


def make_preprocess_settlement_report() -> ParsedSettlementReport:
    """Build a unique parsed report with order and no-SKU rows for preprocessing."""
    unique_id: str = uuid4().hex
    sku: str = f"test-sku-{unique_id}"
    order_id: str = f"test-order-{unique_id}"

    return ParsedSettlementReport(
        settlement=ParsedSettlement(
            amz_region="NA",
            amz_settlement_id=f"test-preprocess-settlement-{unique_id}",
            amz_document_id=f"test-preprocess-document-{unique_id}",
            amz_settlement_start_date="01.04.2026 00:00:00 UTC",
            amz_settlement_end_date="30.04.2026 00:00:00 UTC",
            amz_deposit_date="01.05.2026 00:00:00 UTC",
            amz_total_amount="6.60",
            amz_currency="USD",
        ),
        transactions=[
            ParsedSettlementTransaction(
                amz_report_line_no=3,
                amz_transaction_type="Order",
                amz_order_id=order_id,
                amz_merchant_order_id=order_id,
                amz_adjustment_id=None,
                amz_shipment_id="shipment-1",
                amz_marketplace_name="Amazon.com",
                amz_amount_type="ItemPrice",
                amz_amount_description="Principal",
                amz_amount="10,00",
                amz_fulfillment_id="AFN",
                amz_posted_date="15.04.2026",
                amz_posted_date_time="15.04.2026 06:33:36 UTC",
                amz_order_item_code="order-item-1",
                amz_merchant_order_item_id=None,
                amz_merchant_adjustment_item_id=None,
                amz_sku=sku,
                amz_quantity_purchased="1",
                amz_promotion_id=None,
            ),
            ParsedSettlementTransaction(
                amz_report_line_no=4,
                amz_transaction_type="Order",
                amz_order_id=order_id,
                amz_merchant_order_id=order_id,
                amz_adjustment_id=None,
                amz_shipment_id="shipment-1",
                amz_marketplace_name="Amazon.com",
                amz_amount_type="ItemFees",
                amz_amount_description="Commission",
                amz_amount="-1.50",
                amz_fulfillment_id="AFN",
                amz_posted_date="15.04.2026",
                amz_posted_date_time="15.04.2026 06:33:36 UTC",
                amz_order_item_code="order-item-1",
                amz_merchant_order_item_id=None,
                amz_merchant_adjustment_item_id=None,
                amz_sku=sku,
                amz_quantity_purchased="1",
                amz_promotion_id=None,
            ),
            ParsedSettlementTransaction(
                amz_report_line_no=5,
                amz_transaction_type="Order",
                amz_order_id=order_id,
                amz_merchant_order_id=order_id,
                amz_adjustment_id=None,
                amz_shipment_id="shipment-1",
                amz_marketplace_name="Amazon.com",
                amz_amount_type="Promotion",
                amz_amount_description="Principal",
                amz_amount="-2.00",
                amz_fulfillment_id="AFN",
                amz_posted_date="15.04.2026",
                amz_posted_date_time="15.04.2026 06:33:36 UTC",
                amz_order_item_code="order-item-1",
                amz_merchant_order_item_id=None,
                amz_merchant_adjustment_item_id=None,
                amz_sku=sku,
                amz_quantity_purchased="1",
                amz_promotion_id=None,
            ),
            ParsedSettlementTransaction(
                amz_report_line_no=6,
                amz_transaction_type="Refund",
                amz_order_id=order_id,
                amz_merchant_order_id=order_id,
                amz_adjustment_id=None,
                amz_shipment_id="shipment-1",
                amz_marketplace_name="Amazon.com",
                amz_amount_type="ItemPrice",
                amz_amount_description="Principal",
                amz_amount="-4.00",
                amz_fulfillment_id="AFN",
                amz_posted_date="16.04.2026",
                amz_posted_date_time="16.04.2026 06:33:36 UTC",
                amz_order_item_code="order-item-1",
                amz_merchant_order_item_id=None,
                amz_merchant_adjustment_item_id=None,
                amz_sku=sku,
                amz_quantity_purchased="1",
                amz_promotion_id=None,
            ),
            ParsedSettlementTransaction(
                amz_report_line_no=7,
                amz_transaction_type="other-transaction",
                amz_order_id=None,
                amz_merchant_order_id=None,
                amz_adjustment_id=None,
                amz_shipment_id=None,
                amz_marketplace_name=None,
                amz_amount_type="other-transaction",
                amz_amount_description="Payable to Amazon",
                amz_amount="-3.00",
                amz_fulfillment_id=None,
                amz_posted_date="17.04.2026",
                amz_posted_date_time="17.04.2026 06:33:36 UTC",
                amz_order_item_code=None,
                amz_merchant_order_item_id=None,
                amz_merchant_adjustment_item_id=None,
                amz_sku=None,
                amz_quantity_purchased=None,
                amz_promotion_id=None,
            ),
            ParsedSettlementTransaction(
                amz_report_line_no=8,
                amz_transaction_type="other-transaction",
                amz_order_id=None,
                amz_merchant_order_id=None,
                amz_adjustment_id=None,
                amz_shipment_id=None,
                amz_marketplace_name="Amazon.com",
                amz_amount_type="FBA Inventory Reimbursement",
                amz_amount_description="WAREHOUSE_LOST",
                amz_amount="2.50",
                amz_fulfillment_id=None,
                amz_posted_date="18.04.2026",
                amz_posted_date_time="18.04.2026 06:33:36 UTC",
                amz_order_item_code=None,
                amz_merchant_order_item_id=None,
                amz_merchant_adjustment_item_id=None,
                amz_sku=sku,
                amz_quantity_purchased="1",
                amz_promotion_id=None,
            ),
        ],
    )


def make_extensive_preprocess_fixture() -> ExtensivePreprocessFixture:
    """Build a parsed report that exercises the real preprocessing SQL paths."""
    unique_id: str = uuid4().hex
    sku_exact: str = f"test-sku-exact-{unique_id}"
    sku_all: str = f"test-sku-all-{unique_id}"
    sku_no_fee: str = f"test-sku-no-fee-{unique_id}"
    sku_expired_fee: str = f"test-sku-expired-fee-{unique_id}"
    exact_order_id: str = f"test-order-exact-{unique_id}"
    all_order_id: str = f"test-order-all-{unique_id}"
    no_fee_order_id: str = f"test-order-no-fee-{unique_id}"
    expired_order_id: str = f"test-order-expired-fee-{unique_id}"
    orphan_order_id: str = f"test-order-orphan-{unique_id}"

    def transaction(
        line_no: int,
        transaction_type: str,
        order_id: str | None,
        sku: str | None,
        amount_type: str,
        amount_description: str,
        amount: str,
        *,
        marketplace_name: str | None = "Amazon.com",
        shipment_id: str | None = None,
        fulfillment_id: str | None = "AFN",
        posted_date: str = "15.04.2026",
        posted_date_time: str = "15.04.2026 06:33:36 UTC",
        order_item_code: str | None = None,
        quantity_purchased: str | None = None,
        promotion_id: str | None = None,
    ) -> ParsedSettlementTransaction:
        return ParsedSettlementTransaction(
            amz_report_line_no=line_no,
            amz_transaction_type=transaction_type,
            amz_order_id=order_id,
            amz_merchant_order_id=order_id,
            amz_adjustment_id=None,
            amz_shipment_id=shipment_id,
            amz_marketplace_name=marketplace_name,
            amz_amount_type=amount_type,
            amz_amount_description=amount_description,
            amz_amount=amount,
            amz_fulfillment_id=fulfillment_id,
            amz_posted_date=posted_date,
            amz_posted_date_time=posted_date_time,
            amz_order_item_code=order_item_code,
            amz_merchant_order_item_id=None,
            amz_merchant_adjustment_item_id=None,
            amz_sku=sku,
            amz_quantity_purchased=quantity_purchased,
            amz_promotion_id=promotion_id,
        )

    return ExtensivePreprocessFixture(
        report=ParsedSettlementReport(
            settlement=ParsedSettlement(
                amz_region="NA",
                amz_settlement_id=f"test-extensive-preprocess-settlement-{unique_id}",
                amz_document_id=f"test-extensive-preprocess-document-{unique_id}",
                amz_settlement_start_date="01.04.2026 00:00:00 UTC",
                amz_settlement_end_date="30.04.2026 00:00:00 UTC",
                amz_deposit_date="01.05.2026 00:00:00 UTC",
                amz_total_amount="36.30",
                amz_currency="USD",
            ),
            transactions=[
                transaction(
                    3,
                    "Order",
                    exact_order_id,
                    sku_exact,
                    "ItemPrice",
                    "Principal",
                    "20,00",
                    shipment_id="shipment-exact-1",
                    order_item_code="order-item-exact-1",
                    quantity_purchased="2",
                ),
                transaction(
                    4,
                    "Order",
                    exact_order_id,
                    sku_exact,
                    "ItemPrice",
                    "Tax",
                    "1.50",
                    shipment_id="shipment-exact-1",
                    order_item_code="order-item-exact-1",
                    quantity_purchased="2",
                ),
                transaction(
                    5,
                    "Order",
                    exact_order_id,
                    sku_exact,
                    "ItemFees",
                    "Commission",
                    "-3.00",
                    shipment_id="shipment-exact-1",
                    order_item_code="order-item-exact-1",
                    quantity_purchased="2",
                ),
                transaction(
                    6,
                    "Order",
                    exact_order_id,
                    sku_exact,
                    "ItemWithheldTax",
                    "MarketplaceFacilitatorTax-Principal",
                    "-1.50",
                    shipment_id="shipment-exact-1",
                    order_item_code="order-item-exact-1",
                    quantity_purchased="2",
                ),
                transaction(
                    7,
                    "Order",
                    exact_order_id,
                    sku_exact,
                    "Promotion",
                    "Principal",
                    "-2.00",
                    shipment_id="shipment-exact-1",
                    order_item_code="order-item-exact-1",
                    quantity_purchased="2",
                    promotion_id="promotion-exact-1",
                ),
                transaction(
                    8,
                    "Order",
                    exact_order_id,
                    sku_exact,
                    "ItemPrice",
                    "Principal",
                    "7.00",
                    shipment_id="shipment-exact-1",
                    order_item_code="order-item-exact-2",
                    quantity_purchased="1",
                ),
                transaction(
                    9,
                    "Order",
                    exact_order_id,
                    sku_exact,
                    "ItemFees",
                    "Commission",
                    "-1.05",
                    shipment_id="shipment-exact-1",
                    order_item_code="order-item-exact-2",
                    quantity_purchased="1",
                ),
                transaction(
                    10,
                    "Refund",
                    exact_order_id,
                    sku_exact,
                    "ItemPrice",
                    "Principal",
                    "-5.00",
                    shipment_id="shipment-exact-1",
                    posted_date="16.04.2026",
                    posted_date_time="16.04.2026 06:33:36 UTC",
                    order_item_code="order-item-exact-1",
                    quantity_purchased="1",
                ),
                transaction(
                    11,
                    "Refund",
                    exact_order_id,
                    sku_exact,
                    "ItemFees",
                    "Commission",
                    "0.75",
                    shipment_id="shipment-exact-1",
                    posted_date="16.04.2026",
                    posted_date_time="16.04.2026 06:33:36 UTC",
                    order_item_code="order-item-exact-1",
                    quantity_purchased="1",
                ),
                transaction(
                    12,
                    "Order_Retrocharge",
                    exact_order_id,
                    sku_exact,
                    "ItemPrice",
                    "Tax",
                    "-0.25",
                    shipment_id="shipment-exact-1",
                    posted_date="16.04.2026",
                    posted_date_time="16.04.2026 06:33:36 UTC",
                    order_item_code="order-item-exact-1",
                    quantity_purchased="1",
                ),
                transaction(
                    13,
                    "Order",
                    all_order_id,
                    sku_all,
                    "ItemPrice",
                    "Principal",
                    "12.00",
                    marketplace_name="Amazon.ca",
                    shipment_id="shipment-all-1",
                    posted_date="2026-04-20",
                    posted_date_time="2026-04-20 04:00:00 UTC",
                    order_item_code="order-item-all-1",
                    quantity_purchased="1",
                ),
                transaction(
                    14,
                    "Order",
                    all_order_id,
                    sku_all,
                    "ItemFees",
                    "Commission",
                    "-2.00",
                    marketplace_name="Amazon.ca",
                    shipment_id="shipment-all-1",
                    posted_date="2026-04-20",
                    posted_date_time="2026-04-20 04:00:00 UTC",
                    order_item_code="order-item-all-1",
                    quantity_purchased="1",
                ),
                transaction(
                    15,
                    "Order",
                    no_fee_order_id,
                    sku_no_fee,
                    "ItemPrice",
                    "Principal",
                    "5.00",
                    shipment_id="shipment-no-fee-1",
                    posted_date="21.04.2026",
                    posted_date_time="21.04.2026 04:00:00 UTC",
                    order_item_code="order-item-no-fee-1",
                    quantity_purchased="1",
                ),
                transaction(
                    16,
                    "Order",
                    no_fee_order_id,
                    sku_no_fee,
                    "ItemFees",
                    "Commission",
                    "-1.00",
                    shipment_id="shipment-no-fee-1",
                    posted_date="21.04.2026",
                    posted_date_time="21.04.2026 04:00:00 UTC",
                    order_item_code="order-item-no-fee-1",
                    quantity_purchased="1",
                ),
                transaction(
                    17,
                    "Order",
                    expired_order_id,
                    sku_expired_fee,
                    "ItemPrice",
                    "Principal",
                    "9.00",
                    shipment_id="shipment-expired-fee-1",
                    posted_date="12.04.2026",
                    posted_date_time="12.04.2026 04:00:00 UTC",
                    order_item_code="order-item-expired-fee-1",
                    quantity_purchased="1",
                ),
                transaction(
                    18,
                    "Order",
                    expired_order_id,
                    sku_expired_fee,
                    "ItemFees",
                    "Commission",
                    "-1.00",
                    shipment_id="shipment-expired-fee-1",
                    posted_date="12.04.2026",
                    posted_date_time="12.04.2026 04:00:00 UTC",
                    order_item_code="order-item-expired-fee-1",
                    quantity_purchased="1",
                ),
                transaction(
                    19,
                    "other-transaction",
                    None,
                    None,
                    "other-transaction",
                    "Payable to Amazon",
                    "-3.00",
                    marketplace_name=None,
                    fulfillment_id=None,
                    posted_date="17.04.2026",
                    posted_date_time="17.04.2026 06:33:36 UTC",
                ),
                transaction(
                    20,
                    "other-transaction",
                    None,
                    sku_exact,
                    "FBA Inventory Reimbursement",
                    "WAREHOUSE_LOST",
                    "2.50",
                    fulfillment_id=None,
                    posted_date="18.04.2026",
                    posted_date_time="18.04.2026 06:33:36 UTC",
                    quantity_purchased="1",
                ),
                transaction(
                    21,
                    "other-transaction",
                    orphan_order_id,
                    None,
                    "other-transaction",
                    "Missing SKU",
                    "-0.70",
                    fulfillment_id=None,
                    posted_date="19.04.2026",
                    posted_date_time="19.04.2026 06:33:36 UTC",
                ),
                transaction(
                    22,
                    "other-transaction",
                    None,
                    sku_all,
                    "FBA Inventory Reimbursement",
                    "WAREHOUSE_DAMAGE",
                    "1.25",
                    marketplace_name=None,
                    fulfillment_id=None,
                    posted_date="20.04.2026",
                    posted_date_time="20.04.2026 06:33:36 UTC",
                    quantity_purchased="1",
                ),
            ],
        ),
        sku_exact=sku_exact,
        sku_all=sku_all,
        sku_no_fee=sku_no_fee,
        sku_expired_fee=sku_expired_fee,
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
                delete from private.settlement_transactions_order_transactions
                where order_transaction_id in (
                    select id
                    from private.order_transactions
                    where settlement_id = %s
                )
                """,
                (settlement_id,),
            )
            cursor.execute(
                """
                delete from private.no_sku_transactions
                where settlement_transaction_id in (
                    select id
                    from private.settlement_transactions
                    where settlement_id = %s
                )
                """,
                (settlement_id,),
            )
            cursor.execute(
                """
                delete from private.order_transactions
                where settlement_id = %s
                """,
                (settlement_id,),
            )
            cursor.execute(
                """
                delete from private.preprocess_runs
                where settlement_id = %s
                """,
                (settlement_id,),
            )
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

    def _delete_companies(
        self,
        database: PostgresDatabaseConnection,
        company_ids: list[str],
    ) -> None:
        """Remove company fee fixture rows created by a Postgres integration test."""
        if not company_ids:
            return

        with database.connection() as conn, conn.transaction(), conn.cursor() as cursor:
            for company_id in company_ids:
                cursor.execute(
                    """
                    delete from public.company_fees
                    where company_id = %s
                    """,
                    (company_id,),
                )
                cursor.execute(
                    """
                    delete from public.companies
                    where id = %s
                    """,
                    (company_id,),
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

    def test_preprocess_settlement_transactions_uses_real_local_postgres(self) -> None:
        """Verify order and no-SKU preprocessing against local Postgres."""
        parsed_report: ParsedSettlementReport = make_preprocess_settlement_report()
        sku: str = parsed_report.transactions[0].amz_sku or ""
        settlement_id: str | None = None
        company_id: str | None = None
        company_ids: list[str] = []

        with PostgresDatabaseConnection(LOCAL_SUPABASE_URL) as database:
            try:
                settlement_id = insert_settlement_report(database, parsed_report)
                if settlement_id is None:
                    self.fail("Expected the settlement insert to return an ID.")

                with database.connection() as conn, conn.transaction(), conn.cursor() as cursor:
                    cursor.execute(
                        """
                        insert into public.companies (company_name)
                        values (%s)
                        returning id
                        """,
                        (f"test-company-{uuid4().hex}",),
                    )
                    company_id = str(cursor.fetchone()[0])
                    company_ids.append(company_id)

                    cursor.execute(
                        """
                        insert into public.company_fees (
                            company_id,
                            amz_sku,
                            amz_marketplace_name,
                            fee_rate,
                            valid_period
                        )
                        values (
                            %s,
                            %s,
                            %s,
                            %s,
                            tstzrange(%s::timestamptz, %s::timestamptz, '[)')
                        )
                        """,
                        (
                            company_id,
                            sku,
                            "Amazon.com",
                            Decimal("0.10"),
                            "2026-04-01 00:00:00 UTC",
                            "2026-05-01 00:00:00 UTC",
                        ),
                    )

                results = preprocess_order_then_no_sku(database, settlement_id)
                self.assertEqual(results[0].preprocess_type, "order")
                self.assertEqual(results[0].inserted_count, 1)
                self.assertEqual(results[0].mapping_count, 4)
                self.assertEqual(results[1].preprocess_type, "no_sku")
                self.assertEqual(results[1].inserted_count, 2)

                with database.connection() as conn, conn.cursor(row_factory=dict_row) as cursor:
                    cursor.execute(
                        """
                        select
                            amz_order_item_price,
                            amz_order_item_fees,
                            amz_order_promotion,
                            amz_refund,
                            selbox_fees,
                            net_amount,
                            amz_quantity_purchased,
                            company_id
                        from private.order_transactions
                        where
                            settlement_id = %s
                            and is_current
                        """,
                        (settlement_id,),
                    )
                    order_row = cursor.fetchone()
                    self.assertEqual(order_row["amz_order_item_price"], Decimal("10.000000"))
                    self.assertEqual(order_row["amz_order_item_fees"], Decimal("-1.500000"))
                    self.assertEqual(order_row["amz_order_promotion"], Decimal("-2.000000"))
                    self.assertEqual(order_row["amz_refund"], Decimal("-4.000000"))
                    self.assertEqual(order_row["selbox_fees"], Decimal("-0.400000"))
                    self.assertEqual(order_row["net_amount"], Decimal("2.100000"))
                    self.assertEqual(order_row["amz_quantity_purchased"], 1)
                    self.assertEqual(str(order_row["company_id"]), company_id)

                    cursor.execute(
                        """
                        select count(*)
                        from private.settlement_transactions_order_transactions as sto
                        inner join private.order_transactions as ot
                            on ot.id = sto.order_transaction_id
                        where ot.settlement_id = %s
                        """,
                        (settlement_id,),
                    )
                    self.assertEqual(cursor.fetchone()["count"], 4)

                    cursor.execute(
                        """
                        select
                            nst.amz_sku,
                            nst.amz_amount,
                            nst.company_id
                        from private.no_sku_transactions as nst
                        inner join private.settlement_transactions as st
                            on st.id = nst.settlement_transaction_id
                        where
                            st.settlement_id = %s
                            and nst.is_current
                        order by nst.amz_sku
                        """,
                        (settlement_id,),
                    )
                    no_sku_rows = cursor.fetchall()
                    self.assertEqual(len(no_sku_rows), 2)
                    self.assertEqual(no_sku_rows[0]["amz_sku"], UNKNOWN_SKU)
                    self.assertEqual(no_sku_rows[0]["amz_amount"], Decimal("-3.000000"))
                    self.assertIsNone(no_sku_rows[0]["company_id"])
                    self.assertEqual(no_sku_rows[1]["amz_sku"], sku)
                    self.assertEqual(no_sku_rows[1]["amz_amount"], Decimal("2.500000"))
                    self.assertEqual(str(no_sku_rows[1]["company_id"]), company_id)

                rerun_results = preprocess_order_then_no_sku(database, settlement_id)
                self.assertEqual(rerun_results[0].marked_not_current_count, 1)
                self.assertEqual(rerun_results[1].marked_not_current_count, 2)

                with database.connection() as conn, conn.cursor(row_factory=dict_row) as cursor:
                    cursor.execute(
                        """
                        select
                            count(*) filter (where is_current) as current_count,
                            count(*) as total_count
                        from private.order_transactions
                        where settlement_id = %s
                        """,
                        (settlement_id,),
                    )
                    order_counts = cursor.fetchone()
                    self.assertEqual(order_counts["current_count"], 1)
                    self.assertEqual(order_counts["total_count"], 2)

                    cursor.execute(
                        """
                        select
                            count(*) filter (where nst.is_current) as current_count,
                            count(*) as total_count
                        from private.no_sku_transactions as nst
                        inner join private.settlement_transactions as st
                            on st.id = nst.settlement_transaction_id
                        where st.settlement_id = %s
                        """,
                        (settlement_id,),
                    )
                    no_sku_counts = cursor.fetchone()
                    self.assertEqual(no_sku_counts["current_count"], 2)
                    self.assertEqual(no_sku_counts["total_count"], 4)
            finally:
                self._delete_inserted_settlement(database, settlement_id)
                self._delete_companies(database, company_ids)

    def test_preprocess_settlement_transactions_covers_extensive_real_local_scenarios(
        self,
    ) -> None:
        """Verify preprocessing edge cases against the real local Postgres schema."""
        fixture: ExtensivePreprocessFixture = make_extensive_preprocess_fixture()
        parsed_report: ParsedSettlementReport = fixture.report
        sku_exact: str = fixture.sku_exact
        sku_all: str = fixture.sku_all
        sku_no_fee: str = fixture.sku_no_fee
        sku_expired_fee: str = fixture.sku_expired_fee
        settlement_id: str | None = None
        company_ids: list[str] = []

        with PostgresDatabaseConnection(LOCAL_SUPABASE_URL) as database:
            try:
                settlement_id = insert_settlement_report(database, parsed_report)
                if settlement_id is None:
                    self.fail("Expected the settlement insert to return an ID.")

                with database.connection() as conn, conn.transaction(), conn.cursor() as cursor:
                    for company_name in (
                        f"test-company-exact-{uuid4().hex}",
                        f"test-company-all-{uuid4().hex}",
                        f"test-company-expired-{uuid4().hex}",
                    ):
                        cursor.execute(
                            """
                            insert into public.companies (company_name)
                            values (%s)
                            returning id
                            """,
                            (company_name,),
                        )
                        company_ids.append(str(cursor.fetchone()[0]))

                    company_exact_id, company_all_id, company_expired_id = company_ids
                    fee_rows = [
                        (
                            company_exact_id,
                            sku_exact,
                            "Amazon.com",
                            Decimal("0.20"),
                            "2026-04-01 00:00:00 UTC",
                            "2026-05-01 00:00:00 UTC",
                        ),
                        (
                            company_all_id,
                            sku_exact,
                            ALL_MARKETPLACES,
                            Decimal("0.05"),
                            "2026-04-01 00:00:00 UTC",
                            "2026-05-01 00:00:00 UTC",
                        ),
                        (
                            company_all_id,
                            sku_all,
                            ALL_MARKETPLACES,
                            Decimal("0.10"),
                            "2026-04-01 00:00:00 UTC",
                            "2026-05-01 00:00:00 UTC",
                        ),
                        (
                            company_expired_id,
                            sku_expired_fee,
                            ALL_MARKETPLACES,
                            Decimal("0.50"),
                            "2026-05-01 00:00:00 UTC",
                            "2026-06-01 00:00:00 UTC",
                        ),
                    ]
                    for fee_row in fee_rows:
                        cursor.execute(
                            """
                            insert into public.company_fees (
                                company_id,
                                amz_sku,
                                amz_marketplace_name,
                                fee_rate,
                                valid_period
                            )
                            values (
                                %s,
                                %s,
                                %s,
                                %s,
                                tstzrange(%s::timestamptz, %s::timestamptz, '[)')
                            )
                            """,
                            fee_row,
                        )

                results = preprocess_order_then_no_sku(database, settlement_id)
                self.assertEqual(results[0].preprocess_type, "order")
                self.assertEqual(results[0].inserted_count, 4)
                self.assertEqual(results[0].mapping_count, 16)
                self.assertEqual(results[1].preprocess_type, "no_sku")
                self.assertEqual(results[1].inserted_count, 4)

                with database.connection() as conn, conn.cursor(row_factory=dict_row) as cursor:
                    cursor.execute(
                        """
                        select
                            amz_sku,
                            amz_order_id,
                            amz_marketplace_name,
                            amz_order_item_price,
                            amz_order_item_fees,
                            amz_order_item_withheld_tax,
                            amz_order_promotion,
                            amz_refund,
                            amz_others,
                            selbox_fees,
                            net_amount,
                            amz_quantity_purchased,
                            company_id,
                            company_fee_id,
                            amz_details
                        from private.order_transactions
                        where
                            settlement_id = %s
                            and is_current
                        order by amz_sku
                        """,
                        (settlement_id,),
                    )
                    order_rows = cursor.fetchall()
                    self.assertEqual(len(order_rows), 4)
                    order_rows_by_sku = {row["amz_sku"]: row for row in order_rows}

                    exact_order_row = order_rows_by_sku[sku_exact]
                    self.assertEqual(
                        exact_order_row["amz_order_item_price"],
                        Decimal("28.500000"),
                    )
                    self.assertEqual(
                        exact_order_row["amz_order_item_fees"],
                        Decimal("-4.050000"),
                    )
                    self.assertEqual(
                        exact_order_row["amz_order_item_withheld_tax"],
                        Decimal("-1.500000"),
                    )
                    self.assertEqual(
                        exact_order_row["amz_order_promotion"],
                        Decimal("-2.000000"),
                    )
                    self.assertEqual(exact_order_row["amz_refund"], Decimal("-4.250000"))
                    self.assertEqual(exact_order_row["amz_others"], Decimal("-0.250000"))
                    self.assertEqual(exact_order_row["selbox_fees"], Decimal("-4.300000"))
                    self.assertEqual(exact_order_row["net_amount"], Decimal("12.150000"))
                    self.assertEqual(exact_order_row["amz_quantity_purchased"], 3)
                    self.assertEqual(str(exact_order_row["company_id"]), company_exact_id)
                    self.assertIsNotNone(exact_order_row["company_fee_id"])
                    self.assertEqual(
                        exact_order_row["amz_details"]["source_transaction_count"],
                        10,
                    )
                    self.assertEqual(
                        exact_order_row["amz_details"]["source_report_line_nos"],
                        list(range(3, 13)),
                    )

                    all_order_row = order_rows_by_sku[sku_all]
                    self.assertEqual(all_order_row["amz_marketplace_name"], "Amazon.ca")
                    self.assertEqual(all_order_row["amz_order_item_price"], Decimal("12.000000"))
                    self.assertEqual(all_order_row["amz_order_item_fees"], Decimal("-2.000000"))
                    self.assertEqual(all_order_row["selbox_fees"], Decimal("-1.200000"))
                    self.assertEqual(all_order_row["net_amount"], Decimal("8.800000"))
                    self.assertEqual(str(all_order_row["company_id"]), company_all_id)

                    no_fee_order_row = order_rows_by_sku[sku_no_fee]
                    self.assertEqual(
                        no_fee_order_row["amz_order_item_price"],
                        Decimal("5.000000"),
                    )
                    self.assertEqual(no_fee_order_row["amz_order_item_fees"], Decimal("-1.000000"))
                    self.assertIsNone(no_fee_order_row["selbox_fees"])
                    self.assertIsNone(no_fee_order_row["company_id"])
                    self.assertIsNone(no_fee_order_row["company_fee_id"])
                    self.assertEqual(no_fee_order_row["net_amount"], Decimal("4.000000"))

                    expired_fee_order_row = order_rows_by_sku[sku_expired_fee]
                    self.assertEqual(
                        expired_fee_order_row["amz_order_item_price"],
                        Decimal("9.000000"),
                    )
                    self.assertEqual(
                        expired_fee_order_row["amz_order_item_fees"],
                        Decimal("-1.000000"),
                    )
                    self.assertIsNone(expired_fee_order_row["selbox_fees"])
                    self.assertIsNone(expired_fee_order_row["company_id"])
                    self.assertIsNone(expired_fee_order_row["company_fee_id"])
                    self.assertEqual(expired_fee_order_row["net_amount"], Decimal("8.000000"))

                    cursor.execute(
                        """
                        select count(*)
                        from private.settlement_transactions_order_transactions as sto
                        inner join private.order_transactions as ot
                            on ot.id = sto.order_transaction_id
                        where
                            ot.settlement_id = %s
                            and ot.is_current
                        """,
                        (settlement_id,),
                    )
                    self.assertEqual(cursor.fetchone()["count"], 16)

                    cursor.execute(
                        """
                        select
                            st.amz_report_line_no,
                            nst.amz_sku,
                            nst.amz_order_id,
                            nst.amz_marketplace_name,
                            nst.amz_amount,
                            nst.company_id
                        from private.no_sku_transactions as nst
                        inner join private.settlement_transactions as st
                            on st.id = nst.settlement_transaction_id
                        where
                            st.settlement_id = %s
                            and nst.is_current
                        order by st.amz_report_line_no
                        """,
                        (settlement_id,),
                    )
                    no_sku_rows_by_line = {
                        row["amz_report_line_no"]: row for row in cursor.fetchall()
                    }
                    self.assertEqual(set(no_sku_rows_by_line), {19, 20, 21, 22})
                    self.assertEqual(no_sku_rows_by_line[19]["amz_sku"], UNKNOWN_SKU)
                    self.assertEqual(no_sku_rows_by_line[19]["amz_amount"], Decimal("-3.000000"))
                    self.assertIsNone(no_sku_rows_by_line[19]["company_id"])
                    self.assertEqual(no_sku_rows_by_line[20]["amz_sku"], sku_exact)
                    self.assertEqual(no_sku_rows_by_line[20]["amz_amount"], Decimal("2.500000"))
                    self.assertEqual(str(no_sku_rows_by_line[20]["company_id"]), company_exact_id)
                    self.assertEqual(no_sku_rows_by_line[21]["amz_sku"], UNKNOWN_SKU)
                    self.assertIsNotNone(no_sku_rows_by_line[21]["amz_order_id"])
                    self.assertEqual(no_sku_rows_by_line[21]["amz_amount"], Decimal("-0.700000"))
                    self.assertIsNone(no_sku_rows_by_line[21]["company_id"])
                    self.assertEqual(no_sku_rows_by_line[22]["amz_sku"], sku_all)
                    self.assertIsNone(no_sku_rows_by_line[22]["amz_marketplace_name"])
                    self.assertEqual(no_sku_rows_by_line[22]["amz_amount"], Decimal("1.250000"))
                    self.assertEqual(str(no_sku_rows_by_line[22]["company_id"]), company_all_id)

                rerun_results = preprocess_order_then_no_sku(database, settlement_id)
                self.assertEqual(rerun_results[0].inserted_count, 4)
                self.assertEqual(rerun_results[0].mapping_count, 16)
                self.assertEqual(rerun_results[0].marked_not_current_count, 4)
                self.assertEqual(rerun_results[1].inserted_count, 4)
                self.assertEqual(rerun_results[1].marked_not_current_count, 4)

                with database.connection() as conn, conn.cursor(row_factory=dict_row) as cursor:
                    cursor.execute(
                        """
                        select
                            count(*) filter (where is_current) as current_count,
                            count(*) as total_count
                        from private.order_transactions
                        where settlement_id = %s
                        """,
                        (settlement_id,),
                    )
                    order_counts = cursor.fetchone()
                    self.assertEqual(order_counts["current_count"], 4)
                    self.assertEqual(order_counts["total_count"], 8)

                    cursor.execute(
                        """
                        select
                            count(*) filter (where nst.is_current) as current_count,
                            count(*) as total_count
                        from private.no_sku_transactions as nst
                        inner join private.settlement_transactions as st
                            on st.id = nst.settlement_transaction_id
                        where st.settlement_id = %s
                        """,
                        (settlement_id,),
                    )
                    no_sku_counts = cursor.fetchone()
                    self.assertEqual(no_sku_counts["current_count"], 4)
                    self.assertEqual(no_sku_counts["total_count"], 8)
            finally:
                self._delete_inserted_settlement(database, settlement_id)
                self._delete_companies(database, company_ids)

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
