"""Urgency is ordered before REST pagination without changing current-SKU access."""

from datetime import UTC, date, datetime
from typing import cast
from uuid import uuid7

from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.archives.storage import archive_document
from services.sync.src.database.acquisitions import persist_inventory_acquisition
from services.sync.src.database.company_terms import create_company, publish_sku_terms
from services.sync.src.database.inventory import publish_inventory_capture
from services.sync.src.inventory.models import InventoryAcquisition, PreparedInventory


class InventoryOrderingTests(LocalWorkflowCase):
    def publish_inventory(self, rows: list[dict[str, object]]) -> str:
        created = datetime(2026, 9, 29, 12, tzinfo=UTC)
        acquisition = InventoryAcquisition(
            id=uuid7(),
            seller_namespace=self.seller,
            amazon_scope="NA",
            marketplace_id="ATVPDKIKX0DER",
            marketplace_name="Amazon.com",
            capture_date=date(2026, 9, 29),
            report_id=str(uuid7()),
            report_document_id=str(uuid7()),
            report_created_at=created,
            downloaded_at=created,
            document=archive_document(
                self.storage, b"Inventory urgency fixture", source_compression=None
            ),
            api_metadata={"processingStatus": "DONE"},
        )
        persist_inventory_acquisition(self.database, acquisition)
        return publish_inventory_capture(
            self.database, acquisition, PreparedInventory(tuple(rows), ()), None
        )

    def assign(self, sku: str, company: str) -> None:
        publish_sku_terms(
            self.database,
            sku=sku,
            company_id=company,
            expected_current_version_id=None,
            periods=(),
            change_reason="Inventory urgency access fixture",
        )

    def assert_pages(
        self,
        token: str,
        expected: list[dict[str, object]],
        column: str,
        direction: str,
    ) -> None:
        rank_column = column + "_urgency"

        def sort_key(row: dict[str, object]) -> tuple[bool, int, str]:
            rank = cast(int | None, row[rank_column])
            value = 0 if rank is None else rank
            return rank is None, -value if direction == "desc" else value, cast(str, row["sku"])

        ordered = sorted(expected, key=sort_key)
        for offset in range(0, max(1, len(ordered)), 25):
            response = self.stack.request(
                "GET",
                "/rest/v1/latest_inventory_items",
                token=token,
                params={
                    "select": "sku,health_status,recommended_action,"
                    "health_status_urgency,recommended_action_urgency",
                    "order": f"{rank_column}.{direction}.nullslast,"
                    "sku.asc,marketplace_name.asc,capture_id.asc",
                    "offset": str(offset),
                    "limit": "25",
                },
                headers={"Prefer": "count=exact"},
            )
            self.assertIn(response.status_code, (200, 206))
            self.assertEqual(response.json(), ordered[offset : offset + 25])
            self.assertEqual(response.headers["Content-Range"].rsplit("/", 1)[1], str(len(ordered)))

    def test_urgency_ranks_sort_complete_authorized_rows_before_pagination(self) -> None:
        health_cases = (
            ("Out of stock", 40),
            ("LOW_stock", 30),
            ("Excess", 20),
            ("ExcessStock", 20),
            ("ExcessInventory", 20),
            ("HighStock", 20),
            ("Overstock", 20),
            ("Healthy", 0),
            ("Unfamiliar health status", None),
            (None, None),
        )
        action_cases = (
            ("Edit listing", 50),
            ("GoToRestock", 40),
            ("Restock", 40),
            ("Restock inventory", 40),
            ("SendToFBA", 30),
            ("Advertise_listing", 20),
            ("NoExcessInventory", 0),
            ("No action required", 0),
            ("Unfamiliar source action", None),
            (None, None),
        )
        companies = [create_company(self.database, f"Urgency {self.seller} {n}") for n in (1, 2)]
        expected: list[dict[str, object]] = []
        items: list[dict[str, object]] = []
        for repeat in range(5):
            for index, (health, action) in enumerate(zip(health_cases, action_cases, strict=True)):
                number = repeat * len(health_cases) + index
                sku = f"{self.seller}-{99 - number:02d}"
                expected.append(
                    {
                        "sku": sku,
                        "health_status": health[0],
                        "recommended_action": action[0],
                        "health_status_urgency": health[1],
                        "recommended_action_urgency": action[1],
                    }
                )
                items.append(
                    {
                        "sku": sku,
                        "source_line_number": number + 2,
                        "health_status": health[0],
                        "recommended_action": action[0],
                    }
                )
                # Thirty rows for the first member cross the 25-row page boundary;
                # another member and unassigned source rows must remain hidden.
                if repeat < 4:
                    self.assign(sku, companies[0 if repeat < 3 else 1])
        self.publish_inventory(items)
        _, operator = self.create_operator()
        member_id, first_member = self.create_member(companies[0])
        _, second_member = self.create_member(companies[1])
        _, unprovisioned = self.create_auth_user()
        for token, rows in (
            (operator, expected),
            (first_member, expected[:30]),
            (second_member, expected[30:40]),
            (unprovisioned, []),
        ):
            for column in ("health_status", "recommended_action"):
                for direction in ("asc", "desc"):
                    with self.subTest(row_count=len(rows), column=column, direction=direction):
                        self.assert_pages(token, rows, column, direction)
        revoked = self.stack.request(
            "DELETE", "/rest/v1/app_accounts", token=operator, params={"user_id": "eq." + member_id}
        )
        self.assertEqual(revoked.status_code, 204)
        self.assert_pages(first_member, [], "health_status", "desc")
        denied = self.stack.request(
            "GET",
            "/rest/v1/latest_inventory_items",
            params={"order": "health_status_urgency.desc.nullslast"},
        )
        self.assertIn(denied.status_code, (401, 403))
