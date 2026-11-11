"""Inventory source models and publications for disposable database checks."""

from dataclasses import replace
from datetime import date

from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.source_fixtures import SourceModelFixture, archive_document, new_id
from services.sync.src.database.acquisitions import (
    load_inventory_acquisition,
    persist_inventory_acquisition,
)
from services.sync.src.database.inventory import publish_inventory_capture
from services.sync.src.inventory.models import PreparedInventory
from services.sync.src.inventory.serialization import inventory_from_payload


class InventoryFixture(SourceModelFixture):
    def acquisition_payload(self, **changes: object) -> dict[str, object]:
        return {
            "id": new_id(),
            "seller_namespace": self.seller,
            "amazon_scope": "NA",
            "marketplace_id": "ATVPDKIKX0DER",
            "marketplace_name": "Amazon.com",
            "capture_date": "2026-09-29",
            "report_type": "GET_FBA_INVENTORY_PLANNING_DATA",
            "report_id": new_id(),
            "report_document_id": new_id(),
            "report_created_at": "2026-09-29T12:00:00Z",
            "downloaded_at": "2026-09-29T12:10:00Z",
            "document_sha256": "a" * 64,
            "document": archive_document(),
            "api_metadata": {"processingStatus": "DONE", "capture_timezone": "America/Los_Angeles"},
            **changes,
        }

    def persist_acquisition(self, payload: dict[str, object]) -> str:
        return persist_inventory_acquisition(
            TransactionDatabase(self.connection), inventory_from_payload(payload)
        )

    def acquire(self, **changes: object) -> str:
        return self.persist_acquisition(self.acquisition_payload(**changes))

    def capture(
        self,
        acquisition: str,
        items: list[dict[str, object]],
        *,
        expected: str | None = None,
        preprocess_version: str = "inventory-v1",
        **scope_changes: object,
    ) -> str:
        database = TransactionDatabase(self.connection)
        source = load_inventory_acquisition(database, acquisition)
        if "capture_date" in scope_changes:
            scope_changes["capture_date"] = date.fromisoformat(str(scope_changes["capture_date"]))
        source = replace(source, **scope_changes)
        return publish_inventory_capture(
            database,
            source,
            PreparedInventory(tuple(items), ()),
            expected,
            preprocess_version=preprocess_version,
        )

    @staticmethod
    def item(sku: str = "SKU", quantity: int | None = 5, line: int = 2) -> dict[str, object]:
        return {"sku": sku, "source_line_number": line, "available_quantity": quantity}
