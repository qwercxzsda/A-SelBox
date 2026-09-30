"""Inventory publication payloads for disposable database checks."""

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import (
    SourceModelFixture,
    archive_document,
    new_id,
)


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

    def acquire(self, **changes: object) -> str:
        return self.call("publish_inventory_acquisition", self.acquisition_payload(**changes))

    def capture_payload(
        self,
        acquisition: str,
        items: list[dict[str, object]],
        *,
        expected: str | None = None,
        **changes: object,
    ) -> dict[str, object]:
        seller, marketplace, day = require_row(
            self.connection.execute(
                "select seller_namespace,marketplace_name,capture_date "
                "from private.inventory_acquisitions where id=%s",
                (acquisition,),
            ).fetchone()
        )
        return {
            "id": new_id(),
            "seller_namespace": seller,
            "marketplace_name": marketplace,
            "capture_date": str(day),
            "acquisition_id": acquisition,
            "preprocess_version": "inventory-v1",
            "row_count": len(items),
            "diagnostics": [],
            "expected_current_capture_id": expected,
            "items": items,
            **changes,
        }

    def capture(
        self,
        acquisition: str,
        items: list[dict[str, object]],
        *,
        expected: str | None = None,
        **changes: object,
    ) -> str:
        return self.call(
            "publish_inventory_capture",
            self.capture_payload(acquisition, items, expected=expected, **changes),
        )

    @staticmethod
    def item(sku: str = "SKU", quantity: int | None = 5, line: int = 2) -> dict[str, object]:
        return {"sku": sku, "source_line_number": line, "available_quantity": quantity}
