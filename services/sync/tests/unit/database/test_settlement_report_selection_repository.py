"""Tests for Workflow B report selection."""

import unittest
from uuid import UUID

from ....src.database.settlement_report_selection_repository import (
    select_settlement_report_id,
)
from ...support.fakes import FakeDatabaseConnection

REPORT_ID = str(UUID(int=1))


class TestSettlementReportSelection(unittest.TestCase):
    def test_default_selects_oldest_report_without_any_processing_log(self) -> None:
        database = FakeDatabaseConnection([(REPORT_ID,)])

        selected = select_settlement_report_id(
            database,
            seller_namespace=" seller-na ",
        )

        self.assertEqual(selected, REPORT_ID)
        sql, parameters = database.execute_calls[0]
        self.assertIn("left join private.settlement_processing_logs", sql)
        self.assertIn("processing_log.id is null", sql)
        self.assertIn("order by report.amazon_report_created_at", sql)
        self.assertEqual(parameters, {"seller_namespace": "seller-na"})

    def test_explicit_id_allows_intentional_reprocessing(self) -> None:
        database = FakeDatabaseConnection([(REPORT_ID,)])

        selected = select_settlement_report_id(
            database,
            seller_namespace="seller-na",
            settlement_report_id=REPORT_ID,
        )

        self.assertEqual(selected, REPORT_ID)
        sql, parameters = database.execute_calls[0]
        self.assertNotIn("processing_log", sql)
        self.assertEqual(parameters["settlement_report_id"], REPORT_ID)

    def test_missing_default_is_no_work_but_missing_explicit_id_is_an_error(self) -> None:
        self.assertIsNone(
            select_settlement_report_id(
                FakeDatabaseConnection([None]),
                seller_namespace="seller-na",
            )
        )
        with self.assertRaisesRegex(ValueError, "Unknown"):
            select_settlement_report_id(
                FakeDatabaseConnection([None]),
                seller_namespace="seller-na",
                settlement_report_id=REPORT_ID,
            )


if __name__ == "__main__":
    unittest.main()
