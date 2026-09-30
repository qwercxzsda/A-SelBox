"""Real Auth and REST enforce complete, atomic, operator-only SKU configuration."""

import json
from typing import cast

import httpx

from services.db.supabase.tests.configuration_fixtures import ConfigurationItem
from services.db.supabase.tests.e2e.fixtures import (
    START,
    archived_data_kiosk,
    archived_settlement,
    fixture_sku,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    persist_data_kiosk_acquisition,
    persist_settlement_acquisition,
)
from services.sync.src.database.company_terms import create_company
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_acquisition


class SkuConfigurationRestTests(LocalWorkflowCase):
    def configuration(self, token: str) -> list[ConfigurationItem]:
        response = self.stack.request(
            "POST", "/rest/v1/rpc/sku_configuration", token=token, json={}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"items"})
        return cast(list[ConfigurationItem], response.json()["items"])

    def publish(self, token: str | None, changes: list[dict[str, object]]) -> httpx.Response:
        return self.stack.request(
            "POST",
            "/rest/v1/rpc/publish_sku_configuration",
            token=token,
            json={"p_changes": changes, "p_change_reason": "Complete configuration regression"},
        )

    def import_source(self, seller: str, sku: str, *, kiosk: bool = False) -> None:
        acquisition = persist_settlement_acquisition(
            self.database, archived_settlement(self.storage, seller, sku=sku)
        )
        preprocess_settlement_acquisition(self.database, self.storage, acquisition)
        if kiosk:
            acquisition = persist_data_kiosk_acquisition(
                self.database, archived_data_kiosk(self.storage, seller, sku=sku)
            )
            preprocess_data_kiosk_acquisition(self.database, self.storage, acquisition)

    @staticmethod
    def change(sku: str, company: str) -> dict[str, object]:
        return {
            "sku": sku,
            "company_id": company,
            "expected_current_version_id": None,
            "periods": [
                {
                    "marketplace_name": "Amazon.com",
                    "valid_from": START.isoformat(),
                    "valid_to": None,
                    "fee_rate_percent": "0",
                }
            ],
        }

    def test_global_validation_atomic_repair_future_import_and_conflicts_cross_real_rest(
        self,
    ) -> None:
        company = create_company(self.database, "Configuration company")
        other = create_company(self.database, "Other configuration company")
        _, operator = self.create_operator()
        _, member = self.create_member(company)
        _, other_member = self.create_member(other)
        _, outsider = self.create_auth_user()
        shared, second, future = (
            fixture_sku(self.seller) + suffix for suffix in ("", "-second", "-future")
        )
        self.import_source(self.seller, shared, kiosk=True)
        self.import_source(self.seller + "-two", shared, kiosk=True)
        self.import_source(self.seller + "-other", second)
        original = self.configuration(operator)
        self.assertEqual({item["sku"] for item in original}, {shared, second})
        self.assertTrue(all(item["sku_id"] is None and item["issues"] for item in original))
        self.assertEqual(self.configuration(member), [])
        item = next(item for item in original if item["sku"] == shared)
        self.assertEqual(
            item["requirements"],
            [
                {
                    "marketplace_name": "Amazon.com",
                    "valid_from": "2026-08-01",
                    "valid_to": "2026-08-03",
                }
            ],
        )
        self.assertNotIn("seller_namespace", item)
        changes = [self.change(shared, company)]
        for token in (member, other_member, outsider):
            denied = self.publish(token, changes)
            self.assertEqual(denied.status_code, 403)
        denied = self.publish(None, changes)
        self.assertIn(denied.status_code, (401, 403))
        for token in (None, outsider):
            denied = self.stack.request(
                "POST", "/rest/v1/rpc/sku_configuration", token=token, json={}
            )
            self.assertIn(denied.status_code, (401, 403))
        incomplete = self.publish(operator, changes)
        self.assertEqual(incomplete.status_code, 400)
        self.assertEqual(incomplete.json()["code"], "23514")
        self.assertEqual(incomplete.json()["message"], "SKU configuration is incomplete")
        issues = json.loads(incomplete.json()["details"])["issues"]
        self.assertTrue(
            any(issue["sku"] == second and issue["kind"] == "missing_company" for issue in issues)
        )
        self.assertEqual(self.configuration(operator), original)
        changes = [self.change(shared, company), self.change(second, other)]
        saved = self.publish(operator, changes)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["changed_count"], 2)
        self.assertEqual({item["sku"] for item in saved.json()["published"]}, {shared, second})
        self.assertTrue(all(not item["issues"] for item in self.configuration(operator)))
        self.assertEqual([item["sku"] for item in self.configuration(member)], [shared])
        self.assertEqual([item["sku"] for item in self.configuration(other_member)], [second])
        self.assertEqual(self.configuration(member)[0]["periods"][0]["fee_rate_percent"], "0")
        stale = self.publish(operator, changes)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["code"], "PT409")
        self.assertEqual(stale.json()["message"], "SKU configuration changed while editing")
        self.import_source(self.seller + "-future", future)
        self.assertTrue(
            next(item for item in self.configuration(operator) if item["sku"] == future)["issues"]
        )
        updated = self.change(shared, company)
        updated["expected_current_version_id"] = self.configuration(member)[0]["terms_version_id"]
        incomplete = self.publish(operator, [updated])
        self.assertEqual(incomplete.status_code, 400)
        self.assertEqual(incomplete.json()["message"], "SKU configuration is incomplete")
        self.assertEqual([item["sku"] for item in self.configuration(member)], [shared])
        repaired = self.publish(operator, [self.change(future, company)])
        self.assertEqual(repaired.status_code, 200)
        self.assertTrue(all(not item["issues"] for item in self.configuration(operator)))
        self.assertEqual({item["sku"] for item in self.configuration(member)}, {shared, future})
