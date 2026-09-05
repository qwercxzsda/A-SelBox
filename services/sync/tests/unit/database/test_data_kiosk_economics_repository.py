"""Tests for atomic Data Kiosk provision processes and result retention."""

import json
import unittest
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal, localcontext
from typing import cast
from unittest.mock import patch
from uuid import UUID

from ....src.database.company_sku_fee_rates import (
    LOAD_COMPANY_SKU_FEE_RATES_SQL,
    UnassignedSelboxFeeError,
)
from ....src.database.data_kiosk_economics import repository
from ....src.database.data_kiosk_economics.models import (
    PROCESSOR_VERSION,
    DataKioskProvisionCurrencyError,
    DataKioskProvisionRefresh,
)
from ....src.database.data_kiosk_economics.queries import (
    INSERT_DATA_KIOSK_PROVISION_PROCESSING_LOG_SQL,
    INSERT_DATA_KIOSK_PROVISION_SQL,
    PRUNE_DATA_KIOSK_PROVISION_RESULTS_SQL,
)
from ....src.database.data_kiosk_economics.repository import (
    persist_data_kiosk_provisions,
    persist_data_kiosk_provisions_with_cursor,
    prune_data_kiosk_provision_results,
)
from ....src.numeric import Numeric
from ...support.economics import complete_economics_fact
from ...support.fakes import FakeCursor, FakeDatabaseConnection

US_MARKETPLACE_ID = "ATVPDKIKX0DER"
CA_MARKETPLACE_ID = "A2EUQ1WTGCTBG2"
FEE_RATE_ID = str(UUID(int=1))
COMPANY_ID = str(UUID(int=2))
REFRESHED_AT = datetime(2026, 8, 3, tzinfo=UTC)


def _fee_rate_row(*, sku: str = "SKU-1", fee_rate_percent: str = "7.5") -> tuple[object, ...]:
    return (
        FEE_RATE_ID,
        "seller-na",
        US_MARKETPLACE_ID,
        sku,
        COMPANY_ID,
        Decimal(fee_rate_percent),
        date(2026, 8, 1),
        date(2026, 9, 1),
    )


class TestDataKioskProvisionRepository(unittest.TestCase):
    def test_loads_rates_then_inserts_log_and_results_in_one_transaction(self) -> None:
        database = FakeDatabaseConnection(fetchall_results=[[_fee_rate_row()]])
        refresh = DataKioskProvisionRefresh(
            seller_namespace="seller-na",
            amazon_scope="NA",
            marketplace_ids=(US_MARKETPLACE_ID,),
            facts=(complete_economics_fact(),),
            refreshed_at=REFRESHED_AT,
        )

        result = persist_data_kiosk_provisions(database, refresh)

        self.assertEqual(database.connection_count, 1)
        self.assertEqual(database.connection_obj.transaction_count, 1)
        self.assertEqual(result.refreshed_marketplace_count, 1)
        self.assertEqual(result.provision_row_count, 1)
        self.assertEqual(
            [call[0] for call in database.execute_calls],
            [LOAD_COMPANY_SKU_FEE_RATES_SQL, INSERT_DATA_KIOSK_PROVISION_PROCESSING_LOG_SQL],
        )
        self.assertEqual(UUID(result.processing_log_id).version, 4)
        log = database.execute_calls[1][1]
        self.assertEqual(log["id"], result.processing_log_id)
        self.assertEqual(log["processor_version"], PROCESSOR_VERSION)
        self.assertEqual(log["provision_row_count"], 1)
        self.assertEqual(len(database.executemany_calls), 1)
        insert_sql, inserted_rows = database.executemany_calls[0]
        self.assertEqual(insert_sql, INSERT_DATA_KIOSK_PROVISION_SQL)
        row = inserted_rows[0]
        self.assertEqual(row["processing_log_id"], result.processing_log_id)
        self.assertEqual(row["company_sku_fee_rate_id"], FEE_RATE_ID)
        self.assertEqual(row["company_id"], COMPANY_ID)
        self.assertEqual(row["product_sales"], Decimal("30.375"))
        self.assertEqual(row["product_refunds"], Decimal("10.125"))
        self.assertEqual(row["net_product_sales"], Decimal("20.25"))
        self.assertEqual(row["selbox_fee_base"], Decimal("30.375"))
        self.assertEqual(row["applied_fee_rate_percent"], Decimal("7.5"))
        self.assertEqual(row["selbox_fee"], Decimal("-2.278125"))
        self.assertEqual(row["amazon_fee_total"], Decimal("2.5000000000000000001"))
        self.assertEqual(row["advertising_total"], Decimal("1.005"))
        self.assertEqual(row["amazon_fee_total_quantity"], Decimal(2))
        self.assertEqual(row["advertising_total_quantity"], Decimal(2))
        self.assertIsNone(row["net_proceeds_total_quantity"])
        self.assertEqual(json.loads(str(row["fee_breakdown"]))[0]["identifier"], "fee-1")

    def test_empty_success_records_all_selected_marketplaces_in_its_log(self) -> None:
        cursor = FakeCursor([])
        refresh = DataKioskProvisionRefresh(
            seller_namespace="seller-na",
            amazon_scope="NA",
            marketplace_ids=(US_MARKETPLACE_ID, CA_MARKETPLACE_ID),
            facts=(),
            refreshed_at=REFRESHED_AT,
        )

        result = persist_data_kiosk_provisions_with_cursor(cursor, refresh)

        self.assertEqual(result.provision_row_count, 0)
        self.assertEqual(len(cursor.execute_calls), 1)
        log_sql, parameters = cursor.execute_calls[0]
        self.assertEqual(log_sql, INSERT_DATA_KIOSK_PROVISION_PROCESSING_LOG_SQL)
        self.assertEqual(parameters["id"], result.processing_log_id)
        self.assertEqual(parameters["provision_row_count"], 0)
        self.assertEqual(parameters["seller_namespace"], "seller-na")
        self.assertEqual(parameters["amazon_scope"], "NA")
        self.assertEqual(
            parameters["marketplace_ids"],
            [CA_MARKETPLACE_ID, US_MARKETPLACE_ID],
        )
        self.assertNotIn("activity_date", parameters)
        self.assertFalse(cursor.executemany_calls)

    def test_all_insert_batches_belong_to_the_same_process(self) -> None:
        cursor = FakeCursor(
            [], fetchall_results=[[_fee_rate_row(sku=f"SKU-{i}") for i in range(3)]]
        )
        refresh = DataKioskProvisionRefresh(
            seller_namespace="seller-na",
            amazon_scope="NA",
            marketplace_ids=(US_MARKETPLACE_ID,),
            facts=tuple(replace(complete_economics_fact(), msku=f"SKU-{i}") for i in range(3)),
            refreshed_at=REFRESHED_AT,
        )

        with patch.object(repository, "PROVISION_INSERT_BATCH_SIZE", 2):
            result = persist_data_kiosk_provisions_with_cursor(cursor, refresh)

        self.assertEqual(result.provision_row_count, 3)
        self.assertEqual(cursor.execute_calls[1][1]["provision_row_count"], 3)
        self.assertEqual([len(rows) for _, rows in cursor.executemany_calls], [2, 1])
        self.assertEqual(
            {row["processing_log_id"] for _, rows in cursor.executemany_calls for row in rows},
            {result.processing_log_id},
        )

    def test_unresolved_fee_rate_logs_error_and_aborts_before_any_insert(self) -> None:
        cursor = FakeCursor([], fetchall_results=[[_fee_rate_row()]])
        refresh = DataKioskProvisionRefresh(
            seller_namespace="seller-na",
            amazon_scope="NA",
            marketplace_ids=(US_MARKETPLACE_ID,),
            facts=(complete_economics_fact(), replace(complete_economics_fact(), msku="SKU-2")),
            refreshed_at=REFRESHED_AT,
        )

        with (
            self.assertLogs(repository.__name__, level="ERROR") as logged,
            self.assertRaises(UnassignedSelboxFeeError),
        ):
            persist_data_kiosk_provisions_with_cursor(cursor, refresh)
        self.assertEqual(len(logged.records), 1)
        self.assertIn("sku=SKU-2", logged.output[0])
        self.assertIn("activity_date=2026-08-01", logged.output[0])
        self.assertEqual([sql for sql, _ in cursor.execute_calls], [LOAD_COMPANY_SKU_FEE_RATES_SQL])
        self.assertFalse(cursor.executemany_calls)

    def test_decimal_parameters_and_breakdowns_ignore_context_precision(self) -> None:
        fact = complete_economics_fact()
        large_amount = Numeric("12345678901234567890.123456789")
        small_amount = Numeric("0.000000000000000000001")
        expected_total = Decimal("12345678901234567890.123456789000000000001")
        fee = fact.fees[0]
        ad_detail = fact.ads[0].charge
        if ad_detail is None:
            self.fail("The complete economics fixture must include an ad charge.")
        high_scale_fact = replace(
            fact,
            fees=(
                replace(
                    fee,
                    identifier="fee-large",
                    aggregated_detail=replace(
                        fee.aggregated_detail,
                        total_amount=replace(
                            fee.aggregated_detail.total_amount,
                            amount=large_amount,
                        ),
                    ),
                ),
                replace(
                    fee,
                    identifier="fee-small",
                    aggregated_detail=replace(
                        fee.aggregated_detail,
                        total_amount=replace(
                            fee.aggregated_detail.total_amount,
                            amount=small_amount,
                        ),
                    ),
                ),
            ),
            ads=(
                replace(
                    fact.ads[0],
                    charge=replace(
                        ad_detail,
                        total_amount=replace(
                            ad_detail.total_amount,
                            amount=large_amount,
                        ),
                    ),
                ),
                replace(
                    fact.ads[0],
                    charge=replace(
                        ad_detail,
                        total_amount=replace(
                            ad_detail.total_amount,
                            amount=small_amount,
                        ),
                    ),
                ),
            ),
        )
        cursor = FakeCursor([], fetchall_results=[[_fee_rate_row(fee_rate_percent="0")]])
        refresh = DataKioskProvisionRefresh(
            seller_namespace="seller-na",
            amazon_scope="NA",
            marketplace_ids=(US_MARKETPLACE_ID,),
            facts=(high_scale_fact,),
            refreshed_at=REFRESHED_AT,
        )

        with localcontext() as context, self.assertNoLogs(repository.__name__, level="ERROR"):
            context.prec = 3
            persist_data_kiosk_provisions_with_cursor(cursor, refresh)

        row = cursor.executemany_calls[0][1][0]
        amazon_fee_total = cast(Decimal, row["amazon_fee_total"])
        advertising_total = cast(Decimal, row["advertising_total"])
        self.assertIsInstance(amazon_fee_total, Decimal)
        self.assertIsInstance(advertising_total, Decimal)
        self.assertEqual(amazon_fee_total.as_tuple(), expected_total.as_tuple())
        self.assertEqual(advertising_total.as_tuple(), expected_total.as_tuple())
        self.assertIsNone(row["amazon_fee_total_quantity"])
        self.assertIsNone(row["advertising_total_quantity"])
        decimal_parameter_names = (
            "product_sales",
            "product_refunds",
            "net_product_sales",
            "amazon_fee_total",
            "advertising_total",
            "selbox_fee_base",
            "selbox_fee",
        )
        self.assertTrue(all(type(row[name]) is Decimal for name in decimal_parameter_names))
        fee_breakdown = json.loads(str(row["fee_breakdown"]))
        self.assertEqual(
            [fee["aggregated_detail"]["quantity"] for fee in fee_breakdown], ["2", "2"]
        )
        ad_breakdown = json.loads(str(row["ad_breakdown"]))
        self.assertEqual([ad["charge"]["quantity"] for ad in ad_breakdown], ["2", "2"])
        self.assertEqual(
            fee_breakdown[0]["aggregated_detail"]["total_amount"]["amount"],
            str(large_amount),
        )
        self.assertEqual(
            fee_breakdown[1]["aggregated_detail"]["total_amount"]["amount"],
            str(small_amount),
        )

    def test_builds_every_row_before_inserting_the_log(self) -> None:
        fact = complete_economics_fact()
        mixed_currency = replace(
            fact,
            fees=(
                replace(
                    fact.fees[0],
                    aggregated_detail=replace(
                        fact.fees[0].aggregated_detail,
                        total_amount=replace(
                            fact.fees[0].aggregated_detail.total_amount,
                            currency_code="EUR",
                        ),
                    ),
                ),
            ),
        )
        cursor = FakeCursor([], fetchall_results=[[_fee_rate_row()]])
        refresh = DataKioskProvisionRefresh(
            seller_namespace="seller-na",
            amazon_scope="NA",
            marketplace_ids=(US_MARKETPLACE_ID,),
            facts=(mixed_currency,),
            refreshed_at=REFRESHED_AT,
        )

        with self.assertRaises(DataKioskProvisionCurrencyError):
            persist_data_kiosk_provisions_with_cursor(cursor, refresh)

        self.assertEqual(len(cursor.execute_calls), 1)
        self.assertEqual(cursor.execute_calls[0][0], LOAD_COMPANY_SKU_FEE_RATES_SQL)
        self.assertFalse(cursor.executemany_calls)


class TestPruneDataKioskProvisionResults(unittest.TestCase):
    def test_prunes_selected_seller_scope_in_one_transaction_and_returns_count(self) -> None:
        database = FakeDatabaseConnection(fetchone_results=[(12,)])

        deleted_count = prune_data_kiosk_provision_results(
            database, seller_namespace="seller-na", amazon_scope="NA", keep_latest=3
        )

        self.assertEqual(deleted_count, 12)
        self.assertEqual(database.connection_count, 1)
        self.assertEqual(database.connection_obj.transaction_count, 1)
        self.assertEqual(
            database.execute_calls,
            [
                (
                    PRUNE_DATA_KIOSK_PROVISION_RESULTS_SQL,
                    {"seller_namespace": "seller-na", "amazon_scope": "NA", "keep_latest": 3},
                )
            ],
        )

    def test_rejects_invalid_selection_before_opening_a_connection(self) -> None:
        database = FakeDatabaseConnection()
        for seller_namespace, amazon_scope, keep_latest in (
            ("", "NA", 1),
            ("seller-na", "unknown", 1),
            ("seller-na", "NA", 0),
            ("seller-na", "NA", -1),
            ("seller-na", "NA", True),
        ):
            with (
                self.subTest(
                    seller_namespace=seller_namespace,
                    amazon_scope=amazon_scope,
                    keep_latest=keep_latest,
                ),
                self.assertRaises(ValueError),
            ):
                prune_data_kiosk_provision_results(
                    database,
                    seller_namespace=seller_namespace,
                    amazon_scope=amazon_scope,
                    keep_latest=keep_latest,
                )

        self.assertEqual(database.connection_count, 0)


if __name__ == "__main__":
    unittest.main()
