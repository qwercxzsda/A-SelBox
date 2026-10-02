"""Complete current inventory filter catalogs retain the caller's row access."""

from typing import cast

import psycopg

from services.db.supabase.tests.inventory_fixtures import InventoryFixture
from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.rpc_support import assert_rpc_contract
from services.db.supabase.tests.source_fixtures import new_id


class InventoryFilterOptionsTests(InventoryFixture):
    def options(self, user: str) -> dict[str, object]:
        return cast(
            dict[str, object], self.as_user(user, "select public.inventory_filter_options()")[0][0]
        )

    def assert_empty(self, user: str) -> None:
        self.assertEqual(
            self.options(user), {"skus": [], "health_statuses": [], "recommendations": []}
        )

    def test_empty_and_unprovisioned_accounts_receive_empty_arrays(self) -> None:
        company, _ = self.owner()
        for user in (self.member(company), self.operator(), self.auth_user(), ""):
            self.assert_empty(user)
        self.capture(self.acquire(), [self.item()])
        self.assert_empty(self.auth_user())
        self.assert_empty("")

    def test_members_see_exact_current_owned_skus_and_operators_include_unregistered(self) -> None:
        first_company, _ = self.owner(" SKU ")
        second_company, _ = self.owner("SKU")
        rows = [
            self.item(" SKU ") | {"health_status": "Low", "recommended_action": "Restock"},
            self.item("SKU", line=3) | {"health_status": "Healthy", "recommended_action": "Hold"},
            self.item("UNREGISTERED", line=4)
            | {"health_status": "Source-only status", "recommended_action": "Source-only action"},
        ]
        self.capture(self.acquire(), rows)
        self.capture(self.acquire(seller_namespace="second-source"), [rows[0]])
        self.assertEqual(
            self.options(self.member(first_company)),
            {"skus": [" SKU "], "health_statuses": ["Low"], "recommendations": ["Restock"]},
        )
        self.assertEqual(
            self.options(self.member(second_company)),
            {"skus": ["SKU"], "health_statuses": ["Healthy"], "recommendations": ["Hold"]},
        )
        self.assertEqual(
            self.options(self.operator()),
            {
                "skus": [" SKU ", "SKU", "UNREGISTERED"],
                "health_statuses": ["Healthy", "Low", "Source-only status"],
                "recommendations": ["Hold", "Restock", "Source-only action"],
            },
        )

    def test_latest_capture_excludes_removed_rows_and_empty_capture_hides_old_options(self) -> None:
        company, _ = self.owner()
        member, operator = self.member(company), self.operator()
        old = self.acquire(capture_date="2026-09-28", report_created_at="2026-09-28T12:00:00Z")
        self.capture(
            old,
            [self.item() | {"health_status": "Old health", "recommended_action": "Old action"}],
        )
        self.capture(self.acquire(), [self.item("NEW")])
        self.assert_empty(member)
        self.assertEqual(
            self.options(operator),
            {"skus": ["NEW"], "health_statuses": [None], "recommendations": [None]},
        )
        empty = self.acquire(capture_date="2026-09-30", report_created_at="2026-09-30T12:00:00Z")
        self.capture(empty, [])
        self.assert_empty(operator)
        self.assert_empty(member)

    def test_punctuation_case_and_null_labels_are_lossless_distinct_and_c_sorted(self) -> None:
        values = [None, "Unknown", "unknown", 'a,"b"\\c.(d)', "é", "z", None]
        skus = [f' SKU,{index}.\\" ' for index in range(len(values))]
        rows = [
            self.item(sku, line=index + 2) | {"health_status": value, "recommended_action": value}
            for index, (sku, value) in enumerate(zip(skus, values, strict=True))
        ]
        self.capture(self.acquire(), rows)
        self.capture(self.acquire(seller_namespace="duplicate-source"), rows)
        labels = sorted({value for value in values if value is not None}, key=str.encode)
        self.assertEqual(
            self.options(self.operator()),
            {
                "skus": sorted(skus, key=str.encode),
                "health_statuses": [*labels, None],
                "recommendations": [*labels, None],
            },
        )

    def test_complete_catalog_exceeds_default_api_row_limit(self) -> None:
        values = [f"value-{index:04d}" for index in range(1050)]
        rows = [
            self.item(value, line=index + 2) | {"health_status": value, "recommended_action": value}
            for index, value in enumerate(reversed(values))
        ]
        self.capture(self.acquire(), rows)
        self.assertEqual(
            self.options(self.operator()),
            {"skus": values, "health_statuses": values, "recommendations": values},
        )

    def test_ownership_reassignment_changes_catalog_without_republishing_inventory(self) -> None:
        first_company, sku_id = self.owner()
        second_company, _ = self.owner("OTHER")
        first_member, second_member = self.member(first_company), self.member(second_company)
        self.capture(self.acquire(), [self.item()])
        self.assertEqual(self.options(first_member)["skus"], ["SKU"])
        self.assert_empty(second_member)
        current = require_row(
            self.connection.execute(
                "select current_terms_version_id::text from public.skus where id=%s", (sku_id,)
            ).fetchone()
        )[0]
        self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": sku_id,
                "sku": "SKU",
                "company_id": second_company,
                "expected_current_version_id": current,
                "change_reason": "Reassign inventory filter ownership",
                "periods": [],
            },
        )
        self.assert_empty(first_member)
        self.assertEqual(self.options(second_member)["skus"], ["SKU"])

    def test_invoker_contract_and_execution_grants(self) -> None:
        assert_rpc_contract(self, "inventory_filter_options", {})
        for role in ("anon", "service_role"):
            with (
                self.subTest(role=role),
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute("select set_config('role',%s,true)", (role,))
                self.connection.execute("select public.inventory_filter_options()")
