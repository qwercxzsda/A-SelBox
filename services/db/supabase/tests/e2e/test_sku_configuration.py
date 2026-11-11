"""Real Auth and REST enforce complete, atomic, administrator-only SKU configuration."""

import json
from typing import cast
from uuid import uuid7

import httpx

from services.db.supabase.tests.configuration_fixtures import ConfigurationItem
from services.db.supabase.tests.e2e.fixtures import (
    START,
    archived_data_kiosk,
    archived_finances,
    fixture_sku,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    persist_data_kiosk_acquisition,
)
from services.sync.src.database.company_terms import create_company
from services.sync.src.finances.workflow import preprocess_finances_acquisition


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
        acquisition = archived_finances(self.storage, seller, sku=sku)
        preprocess_finances_acquisition(self.database, self.storage, acquisition)
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

    def test_changed_sku_validation_atomic_repair_and_conflicts_cross_real_rest(
        self,
    ) -> None:
        company = create_company(self.database, "Configuration company")
        other = create_company(self.database, "Other configuration company")
        _, administrator = self.create_administrator()
        _, member = self.create_member(company)
        _, other_member = self.create_member(other)
        _, outsider = self.create_auth_user()
        shared, second, future = (
            fixture_sku(self.seller) + suffix for suffix in ("", "-second", "-future")
        )
        self.import_source(self.seller, shared, kiosk=True)
        self.import_source(self.seller + "-two", shared, kiosk=True)
        self.import_source(self.seller + "-other", second)
        original = self.configuration(administrator)
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
        invalid = self.change(second, other)
        invalid["company_id"] = None
        incomplete = self.publish(administrator, [*changes, invalid])
        self.assertEqual(incomplete.status_code, 400)
        self.assertEqual(incomplete.json()["code"], "23514")
        self.assertEqual(incomplete.json()["message"], "SKU configuration is incomplete")
        issues = json.loads(incomplete.json()["details"])["issues"]
        self.assertTrue(
            any(issue["sku"] == second and issue["kind"] == "missing_company" for issue in issues)
        )
        self.assertEqual(self.configuration(administrator), original)
        partial = self.publish(administrator, changes)
        self.assertEqual(partial.status_code, 200)
        self.assertEqual(partial.json()["changed_count"], 1)
        self.assertTrue(
            next(item for item in self.configuration(administrator) if item["sku"] == second)[
                "issues"
            ]
        )
        changes = [self.change(shared, company), self.change(second, other)]
        changes[0]["expected_current_version_id"] = partial.json()["published"][0][
            "terms_version_id"
        ]
        saved = self.publish(administrator, changes)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["changed_count"], 2)
        self.assertEqual({item["sku"] for item in saved.json()["published"]}, {shared, second})
        self.assertTrue(all(not item["issues"] for item in self.configuration(administrator)))
        self.assertEqual([item["sku"] for item in self.configuration(member)], [shared])
        self.assertEqual([item["sku"] for item in self.configuration(other_member)], [second])
        self.assertEqual(self.configuration(member)[0]["periods"][0]["fee_rate_percent"], "0")
        stale = self.publish(administrator, changes)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["code"], "PT409")
        self.assertEqual(json.loads(stale.json()["details"]), {"code": "SKU_CONFIGURATION_STALE"})
        self.import_source(self.seller + "-future", future)
        self.assertTrue(
            next(item for item in self.configuration(administrator) if item["sku"] == future)[
                "issues"
            ]
        )
        updated = self.change(shared, company)
        updated["expected_current_version_id"] = self.configuration(member)[0]["terms_version_id"]
        corrected = self.publish(administrator, [updated])
        self.assertEqual(corrected.status_code, 200)
        self.assertTrue(
            next(item for item in self.configuration(administrator) if item["sku"] == future)[
                "issues"
            ]
        )
        self.assertEqual([item["sku"] for item in self.configuration(member)], [shared])
        repaired = self.publish(administrator, [self.change(future, company)])
        self.assertEqual(repaired.status_code, 200)
        self.assertTrue(all(not item["issues"] for item in self.configuration(administrator)))
        self.assertEqual({item["sku"] for item in self.configuration(member)}, {shared, future})

    def test_untrusted_rest_shapes_casts_and_constraints_cannot_partially_publish(self) -> None:
        company = create_company(self.database, "Untrusted configuration input")
        _, administrator = self.create_administrator()
        first = self.change(fixture_sku(self.seller) + "-A", company)
        last = self.change(fixture_sku(self.seller) + "-Z", company)
        period = cast(list[dict[str, object]], last["periods"])[0]
        invalid: list[object] = [None, [], {}, [None], [first, first]]
        invalid.extend(
            [first, {key: value for key, value in last.items() if key != missing}]
            for missing in ("company_id", "expected_current_version_id", "periods")
        )
        invalid.extend(
            [first, last | fields]
            for fields in (
                {"sku_id": str(uuid7())},
                {"company_id": str(uuid7())},
                {"expected_current_version_id": "invalid-uuid"},
                {"sku": " "},
            )
        )
        invalid.extend(
            [first, last | {"periods": [period | fields]}]
            for fields in (
                {"fee_rate_percent": "NaN"},
                {"fee_rate_percent": "Infinity"},
                {"fee_rate_percent": "not-numeric"},
                {"fee_rate_percent": "-1"},
                {"fee_rate_percent": "100.000001"},
                {"fee_rate_percent": "5.0000000"},
                {"fee_rate_percent": 5},
                {"fee_rate_percent": True},
                {"valid_from": "2026-02-30"},
                {"valid_from": "infinity"},
                {"valid_to": "2026-01-01"},
                {"marketplace_name": "unknown"},
            )
        )
        before = self.configuration(administrator)
        for payload in invalid:
            with self.subTest(payload=payload):
                response = self.stack.request(
                    "POST",
                    "/rest/v1/rpc/publish_sku_configuration",
                    token=administrator,
                    json={"p_changes": payload, "p_change_reason": "Untrusted REST input"},
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], "23514")
                self.assertEqual(
                    json.loads(response.json()["details"]), {"code": "SKU_CONFIGURATION_INVALID"}
                )
                self.assertEqual(self.configuration(administrator), before)
