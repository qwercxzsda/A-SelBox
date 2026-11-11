"""Raw inventory reads retain exact statuses and ownership across transport pages."""

from datetime import UTC, date, datetime
from typing import cast
from uuid import uuid7

from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.archives.storage import archive_document
from services.sync.src.database.acquisitions import persist_inventory_acquisition
from services.sync.src.database.company_terms import create_company, publish_sku_terms
from services.sync.src.database.inventory import publish_inventory_capture
from services.sync.src.inventory.models import InventoryAcquisition, PreparedInventory
from services.sync.src.inventory.vocabulary import HEALTH_STATUSES, RECOMMENDED_ACTIONS


class InventoryReadTests(LocalWorkflowCase):
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
                self.storage, b"Inventory read fixture", source_compression=None
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
            change_reason="Inventory read access fixture",
        )

    def assert_pages(
        self,
        token: str,
        expected: list[dict[str, object]],
    ) -> None:
        ordered = sorted(expected, key=lambda row: cast(str, row["sku"]))
        for offset in range(0, max(1, len(ordered)), 25):
            response = self.stack.request(
                "GET",
                "/rest/v1/latest_inventory_items",
                token=token,
                params={
                    "select": "sku,health_status,recommended_action",
                    "order": "sku.asc,marketplace_name.asc,capture_id.asc",
                    "offset": str(offset),
                    "limit": "25",
                },
                headers={"Prefer": "count=exact"},
            )
            self.assertIn(response.status_code, (200, 206))
            self.assertEqual(response.json(), ordered[offset : offset + 25])
            self.assertEqual(response.headers["Content-Range"].rsplit("/", 1)[1], str(len(ordered)))

    def test_complete_current_authorized_rows_across_transport_pages(self) -> None:
        health_cases = (*HEALTH_STATUSES, None)
        action_cases = (*RECOMMENDED_ACTIONS, None)
        companies = [create_company(self.database, f"Inventory {self.seller} {n}") for n in (1, 2)]
        expected: list[dict[str, object]] = []
        items: list[dict[str, object]] = []
        for repeat in range(5):
            for index, action in enumerate(action_cases):
                health = health_cases[index % len(health_cases)]
                number = repeat * len(action_cases) + index
                sku = f"{self.seller}-{99 - number:02d}"
                expected.append(
                    {
                        "sku": sku,
                        "health_status": health,
                        "recommended_action": action,
                    }
                )
                items.append(
                    {
                        "sku": sku,
                        "source_line_number": number + 2,
                        "health_status": health,
                        "recommended_action": action,
                    }
                )
                # Three groups for the first member cross the 25-row page boundary;
                # another member and unassigned source rows must remain hidden.
                if repeat < 4:
                    self.assign(sku, companies[0 if repeat < 3 else 1])
        self.publish_inventory(items)
        _, administrator = self.create_administrator()
        member_id, first_member = self.create_member(companies[0])
        _, second_member = self.create_member(companies[1])
        _, unprovisioned = self.create_auth_user()
        first_member_end, second_member_end = 3 * len(action_cases), 4 * len(action_cases)
        for token, rows in (
            (administrator, expected),
            (first_member, expected[:first_member_end]),
            (second_member, expected[first_member_end:second_member_end]),
            (unprovisioned, []),
        ):
            with self.subTest(row_count=len(rows)):
                self.assert_pages(token, rows)
        revoked = self.set_membership(administrator, member_id, None)
        self.assertEqual(revoked.status_code, 200)
        self.assert_pages(first_member, [])
        denied = self.stack.request(
            "GET",
            "/rest/v1/latest_inventory_items",
            params={"order": "sku.asc"},
        )
        self.assertIn(denied.status_code, (401, 403))
