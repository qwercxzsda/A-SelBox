"""Verify removal request-date ownership through fee loading and persistence."""

import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast
from uuid import UUID

from ....src.database.company_sku_fee_rates import UnassignedSelboxFeeError
from ....src.settlement_processing import workflow
from ....src.settlement_processing.workflow import AuxiliaryLoader, process_settlement_report
from ...support.fakes import FakeDatabaseConnection
from ...support.settlement_processing import (
    MARKETPLACE_ID,
    SETTLEMENT_REPORT_ID,
    stored_report_database_rows,
)
from ...support.settlement_processing_plans import make_auxiliary_observation

_REQUEST_DATE = date(2026, 5, 1)
_POSTED_DATES = (date(2026, 8, 2), date(2026, 8, 12))
_REQUEST_FEE_ID = str(UUID(int=401))
_REQUEST_COMPANY_ID = str(UUID(int=402))
_POSTING_FEE_ID = str(UUID(int=403))
_POSTING_COMPANY_ID = str(UUID(int=404))
_REMOVAL_CATEGORIES = (
    ("RemovalComplete", "REMOVAL_FEES"),
    ("DisposalComplete", "DISPOSAL_FEES"),
)


def _removal_database(
    amount_description: str,
    *,
    include_request_date_fee: bool,
) -> FakeDatabaseConnection:
    report_row, content_rows = stored_report_database_rows()
    columns = cast(list[str], report_row[5])
    metadata = cast(list[str], report_row[6])
    metadata[columns.index("total-amount")] = "-10.00"
    for index, row in enumerate(content_rows):
        values = cast(list[str], row[2])
        posted_date = _POSTED_DATES[index].isoformat()
        overrides = {
            "transaction-type": "FBAFees",
            "amount-type": "other-transaction",
            "amount-description": amount_description,
            "amount": "-5.00",
            "posted-date": posted_date,
            "posted-date-time": f"{posted_date}T12:00:00Z",
            "sku": "",
            "quantity-purchased": "",
            "order-id": f"order-{index}",
            "shipment-id": f"shipment-{index}",
            "adjustment-id": "R1",
        }
        for column, value in overrides.items():
            values[columns.index(column)] = value
    fee_rows: list[tuple[object, ...]] = [
        (
            _POSTING_FEE_ID,
            "seller-na",
            MARKETPLACE_ID,
            "SKU-1",
            _POSTING_COMPANY_ID,
            Decimal("7"),
            date(2026, 7, 1),
            None,
        )
    ]
    if include_request_date_fee:
        fee_rows.append(
            (
                _REQUEST_FEE_ID,
                "seller-na",
                MARKETPLACE_ID,
                "SKU-1",
                _REQUEST_COMPANY_ID,
                Decimal("3"),
                date(2026, 1, 1),
                date(2026, 7, 1),
            )
        )
    return FakeDatabaseConnection(
        [(SETTLEMENT_REPORT_ID,), report_row],
        fetchall_results=[content_rows, fee_rows],
    )


def _removal_loader(category: str) -> AuxiliaryLoader:
    observation = make_auxiliary_observation(
        "-10",
        source_system="FBA_REPORT",
        category_code=category,
        source_start_date=_REQUEST_DATE,
        source_end_date=_REQUEST_DATE,
        removal_order_id="R1",
    )
    return lambda _settlement, _requirements, _artifacts: (observation,)


class TestRemovalRequestDateWorkflow(unittest.TestCase):
    def test_request_date_fee_is_loaded_and_persisted_with_original_postings(self) -> None:
        for amount_description, category in _REMOVAL_CATEGORIES:
            with self.subTest(category=category):
                database = _removal_database(amount_description, include_request_date_fee=True)
                with TemporaryDirectory() as temporary_directory:
                    result = process_settlement_report(
                        database,
                        _removal_loader(category),
                        seller_namespace="seller-na",
                        artifact_root=Path(temporary_directory),
                    )
                self.assertEqual(result.processed_entry_count, 2)
                self.assertEqual(result.processed_result_count, 1)
                self._assert_request_date_was_queried(database)
                persisted_results = next(
                    rows
                    for sql, rows in database.executemany_calls
                    if "insert into private.settlement_processed_results" in sql
                )
                target = persisted_results[0]
                self.assertEqual(target["company_id"], _REQUEST_COMPANY_ID)
                self.assertEqual(target["company_sku_fee_rate_id"], _REQUEST_FEE_ID)
                self.assertEqual(target["applied_fee_rate_percent"], Decimal("3"))
                self.assertEqual(target["category_code"], category)
                self.assertEqual(target["activity_start_date"], _REQUEST_DATE)
                self.assertEqual(target["activity_end_date"], _REQUEST_DATE)
                self.assertEqual(target["settlement_amount"], Decimal("-10"))
                persisted_entries = next(
                    rows
                    for sql, rows in database.executemany_calls
                    if "insert into private.settlement_processed_entries" in sql
                )
                self.assertEqual(
                    {row["posted_date"] for row in persisted_entries}, set(_POSTED_DATES)
                )
                self.assertEqual(
                    {row["amazon_shipment_id"] for row in persisted_entries},
                    {"shipment-0", "shipment-1"},
                )

    def test_posting_date_fee_cannot_fill_missing_request_date_coverage(self) -> None:
        for amount_description, category in _REMOVAL_CATEGORIES:
            with self.subTest(category=category):
                database = _removal_database(amount_description, include_request_date_fee=False)
                with (
                    TemporaryDirectory() as temporary_directory,
                    self.assertLogs(workflow.__name__, level="ERROR") as logged,
                    self.assertRaises(UnassignedSelboxFeeError),
                ):
                    process_settlement_report(
                        database,
                        _removal_loader(category),
                        seller_namespace="seller-na",
                        artifact_root=Path(temporary_directory),
                    )
                self.assertIn("activity_start_date=2026-05-01", logged.output[0])
                self._assert_request_date_was_queried(database)
                self.assertEqual(database.connection_obj.transaction_count, 0)
                self.assertEqual(database.executemany_calls, [])
                self.assertFalse(any("insert into" in sql for sql, _ in database.execute_calls))

    def _assert_request_date_was_queried(self, database: FakeDatabaseConnection) -> None:
        parameters = next(
            parameters
            for _sql, parameters in database.execute_calls
            if "activity_date_from" in parameters
        )
        self.assertEqual(parameters["activity_date_from"], _REQUEST_DATE)
        self.assertGreaterEqual(cast(date, parameters["activity_date_to"]), max(_POSTED_DATES))


if __name__ == "__main__":
    unittest.main()
