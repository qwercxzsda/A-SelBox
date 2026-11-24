"""Isolated integration of archived bytes, offline parsing, and live SQL fees."""

import unittest
from uuid import uuid7

from services.db.supabase.tests.finances_fixtures import finances_capture, native_transaction
from services.db.supabase.tests.integration_support import (
    DatabaseTestCase,
    TransactionDatabase,
)
from services.sync.src.finances.acquisition_models import FinancesAcquisition
from services.sync.src.finances.workflow import preprocess_finances_acquisition
from services.sync.tests.support.archives import MemoryArchiveStorage


class TestArchiveToLive(DatabaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.database = TransactionDatabase(self.connection)
        self.storage = MemoryArchiveStorage()
        self.seller = f"archive-integration-{uuid7()}"

    def save_finances(self, *, valid: bool = True) -> FinancesAcquisition:
        rows = [
            native_transaction(100, sku="SKU-1" if valid else None),
            native_transaction(-100, kind="Refund", day="2026-08-02"),
            native_transaction(-10, kind="ServiceFee", sku=None, day="2026-08-02"),
        ]
        return finances_capture(self.storage, rows, seller=self.seller)

    def test_downloaded_sales_and_refunds_enter_activity_once(self) -> None:
        capture = self.save_finances()
        for _ in range(2):
            preprocess_finances_acquisition(self.database, self.storage, capture)
        by_type = dict(
            self.connection.execute(
                "select component_type,sum(base_amount + tax_amount) from "
                "private.financial_outcomes group by component_type"
            ).fetchall()
        )
        self.assertEqual(
            by_type, {"PRODUCT_SALES": 100, "PRODUCT_REFUNDS": -100, "DISPOSAL_FEES": -10}
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_transactions"
            ).fetchone(),
            (3,),
        )

    def test_failed_preprocessing_keeps_archives_without_success_database_rows(self) -> None:
        acquisition_id = self.save_finances(valid=False)
        with self.assertRaises(ValueError):
            preprocess_finances_acquisition(self.database, self.storage, acquisition_id)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.source_acquisitions where id = %s",
                (acquisition_id.id,),
            ).fetchone(),
            (0,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.source_preprocess_batches where acquisition_id=%s",
                (acquisition_id.id,),
            ).fetchone(),
            (0,),
        )
        self.assertEqual(len(self.storage.objects), 2)


if __name__ == "__main__":
    unittest.main()
