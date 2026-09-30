"""Current scope selection precedes exact-SKU ownership and row filtering."""

import psycopg
from psycopg.types.json import Jsonb

from services.db.supabase.tests.inventory_fixtures import InventoryFixture
from services.db.supabase.tests.source_fixtures import new_id


class InventoryAccessTests(InventoryFixture):
    def test_latest_empty_scope_hides_previous_day_in_views_and_member_base_reads(self) -> None:
        company, _ = self.owner()
        member, operator = self.member(company), self.operator()
        old = self.acquire(capture_date="2026-09-28", report_created_at="2026-09-28T12:00:00Z")
        self.capture(old, [self.item()])
        latest = self.capture(self.acquire(), [])
        for user in (member, operator):
            self.assertEqual(self.as_user(user, "select * from public.latest_inventory_items"), [])
            self.assertEqual(
                self.as_user(user, "select capture_id::text from public.latest_inventory_captures"),
                [(latest,)],
            )
        self.assertEqual(self.as_user(member, "select * from private.inventory_items"), [])
        self.assertEqual(len(self.as_user(operator, "select * from private.inventory_items")), 1)

    def test_ownership_is_exact_sku_across_namespaces_and_headers_remain_private(self) -> None:
        company, _ = self.owner(" SKU ")
        member, operator = self.member(company), self.operator()
        first = self.acquire()
        self.capture(first, [self.item(" SKU "), self.item("SKU", 99, 3)])
        second = self.acquire(seller_namespace="other-import")
        self.capture(second, [self.item(" SKU ", 7)])
        self.assertEqual(
            self.as_user(
                member,
                "select sku,available_quantity,seller_namespace,company_id::text "
                "from public.latest_inventory_items order by available_quantity",
            ),
            [(" SKU ", 5, None, company), (" SKU ", 7, None, company)],
        )
        self.assertEqual(
            len(self.as_user(operator, "select * from public.latest_inventory_items")), 3
        )
        self.assertEqual(self.as_user(member, "select * from private.inventory_acquisitions"), [])
        self.assertEqual(self.as_user(member, "select * from private.inventory_daily_captures"), [])
        self.assertEqual(
            len(self.as_user(operator, "select * from private.inventory_acquisitions")), 2
        )
        self.assertEqual(
            self.as_user(self.auth_user(), "select * from public.latest_inventory_captures"), []
        )

    def test_reassignment_changes_inventory_access_without_rewriting_source_rows(self) -> None:
        original_company, identity = self.owner()
        next_company, _ = self.owner("OTHER")
        original_member = self.member(original_company)
        next_member = self.member(next_company)
        capture = self.capture(self.acquire(), [self.item()])
        selected = self.connection.execute(
            "select current_terms_version_id::text from public.skus where id=%s", (identity,)
        ).fetchone()
        self.assertIsNotNone(selected)
        assert selected is not None  # noqa: S101 - type narrowing after assertion
        self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": identity,
                "sku": "SKU",
                "company_id": next_company,
                "expected_current_version_id": selected[0],
                "change_reason": "Reassign current inventory",
                "periods": [],
            },
        )
        self.assertEqual(
            self.as_user(original_member, "select * from public.latest_inventory_items"), []
        )
        self.assertEqual(
            self.as_user(
                next_member,
                "select capture_id::text,company_id::text from public.latest_inventory_items",
            ),
            [(capture, next_company)],
        )

    def test_api_roles_cannot_publish_or_mutate_inventory(self) -> None:
        company, _ = self.owner()
        acquisition = self.acquire()
        payload = self.capture_payload(acquisition, [self.item()])
        for user in (self.member(company), self.operator(), self.auth_user()):
            with self.subTest(user=user), self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(
                    user, "select private.publish_inventory_capture(%s)", (Jsonb(payload),)
                )
            with self.subTest(user=user), self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(user, "delete from private.inventory_daily_captures returning id")
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select * from public.latest_inventory_items")
