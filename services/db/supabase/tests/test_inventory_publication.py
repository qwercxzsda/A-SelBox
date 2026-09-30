"""Archived inventory and sole daily captures retain independent source evidence."""

from decimal import Decimal

import psycopg

from services.db.supabase.tests.inventory_fixtures import InventoryFixture
from services.db.supabase.tests.source_fixtures import new_id


class InventoryPublicationTests(InventoryFixture):
    def test_acquisition_retry_reuses_identity_and_rejects_changed_source(self) -> None:
        payload = self.acquisition_payload()
        original = self.call("publish_inventory_acquisition", payload)
        self.assertEqual(
            self.call("publish_inventory_acquisition", payload | {"id": new_id()}), original
        )
        for changes in (
            {"document_sha256": "b" * 64},
            {"report_document_id": "different-document"},
            {"capture_date": "2026-09-28"},
            {"marketplace_id": "different-marketplace"},
        ):
            with (
                self.subTest(changes=changes),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.call("publish_inventory_acquisition", payload | changes)
        for statement in (
            "delete from private.inventory_acquisitions",
            "update private.inventory_acquisitions set downloaded_at=now()",
            "truncate private.inventory_acquisitions cascade",
        ):
            with (
                self.subTest(statement=statement),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(statement)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.inventory_acquisitions"
            ).fetchone(),
            (1,),
        )

    def test_same_day_replacement_removes_old_rows_and_preserves_other_days_and_archives(
        self,
    ) -> None:
        previous = self.acquire(capture_date="2026-09-28", report_created_at="2026-09-28T12:00:00Z")
        previous_capture = self.capture(previous, [self.item("YESTERDAY", 10)])
        first = self.acquire()
        first_capture = self.capture(first, [self.item("SKU", 5), self.item("REMOVED", 8, 3)])
        second = self.acquire(report_created_at="2026-09-29T13:00:00Z")
        replacement = self.capture(second, [self.item("SKU", 3)], expected=first_capture)
        self.assertNotEqual(first_capture, replacement)
        self.assertEqual(
            self.connection.execute(
                "select id::text from private.inventory_daily_captures order by capture_date"
            ).fetchall(),
            [(previous_capture,), (replacement,)],
        )
        self.assertEqual(
            self.connection.execute(
                "select sku,available_quantity from private.inventory_items order by sku"
            ).fetchall(),
            [("SKU", 3), ("YESTERDAY", 10)],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.inventory_acquisitions"
            ).fetchone(),
            (3,),
        )

    def test_stale_scope_and_older_observation_rejections_preserve_capture(self) -> None:
        first = self.acquire()
        original = self.capture(first, [self.item()])
        later = self.acquire(report_created_at="2026-09-29T13:00:00Z")
        with self.assertRaises(psycopg.errors.SerializationFailure), self.connection.transaction():
            self.capture(later, [], expected=None)
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.capture(later, [], expected=original, id=original)
        replacement = self.capture(later, [], expected=original)
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.capture(first, [self.item()], expected=replacement)
        for changes in (
            {"seller_namespace": "wrong-seller"},
            {"marketplace_name": "Amazon.ca"},
            {"capture_date": "2026-09-30"},
        ):
            with (
                self.subTest(changes=changes),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.capture(later, [], expected=replacement, **changes)
        self.assertEqual(
            self.connection.execute(
                "select id::text from private.inventory_daily_captures"
            ).fetchall(),
            [(replacement,)],
        )

    def test_same_acquisition_parser_retry_is_noop_and_parser_replay_keeps_original_day(
        self,
    ) -> None:
        acquisition = self.acquire()
        original = self.capture(acquisition, [self.item()])
        self.assertEqual(self.capture(acquisition, [self.item()]), original)
        revised = self.capture(
            acquisition,
            [self.item(quantity=4)],
            expected=original,
            preprocess_version="inventory-v2",
        )
        self.assertNotEqual(revised, original)
        self.assertEqual(
            self.connection.execute(
                "select capture_date::text,row_count,preprocess_version "
                "from private.inventory_daily_captures"
            ).fetchall(),
            [("2026-09-29", 1, "inventory-v2")],
        )

    def test_invalid_replacement_rolls_back_header_delete_and_children(self) -> None:
        first = self.acquire()
        original = self.capture(first, [self.item()])
        later = self.acquire(report_created_at="2026-09-29T13:00:00Z")
        with self.assertRaises(psycopg.errors.UniqueViolation), self.connection.transaction():
            self.capture(later, [self.item(), self.item(line=3)], expected=original)
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.capture(later, [self.item(quantity=-1)], expected=original)
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.capture(later, [], expected=original, row_count=1)
        self.assertEqual(
            self.connection.execute(
                "select c.id::text,i.available_quantity from private.inventory_daily_captures c "
                "join private.inventory_items i on i.capture_id=c.id"
            ).fetchall(),
            [(original, 5)],
        )

    def test_nullable_metrics_source_dates_and_finite_decimal_estimates(self) -> None:
        acquisition = self.acquire()
        metrics = self.item(" SKU ", 0) | {
            "snapshot_date": "2026-09-27",
            "sales_amount_90d": "123.456789",
            "currency": "USD",
            "days_of_supply": "2.5",
            "health_status": "FUTURE_AMAZON_LABEL",
        }
        self.capture(acquisition, [metrics, self.item("UNKNOWN", None, 3)])
        self.assertEqual(
            self.connection.execute(
                "select sku,available_quantity,sales_amount_90d,days_of_supply,"
                "snapshot_date::text,health_status from private.inventory_items order by sku"
            ).fetchall(),
            [
                (
                    " SKU ",
                    0,
                    Decimal("123.456789"),
                    Decimal("2.5"),
                    "2026-09-27",
                    "FUTURE_AMAZON_LABEL",
                ),
                ("UNKNOWN", None, None, None, None, None),
            ],
        )

    def test_inventory_does_not_change_financial_revision_tokens(self) -> None:
        self.owner()
        self.connection.commit()
        before = self.connection.execute(
            "select * from private.workspace_revision_tokens where source <> 'inventory' "
            "order by source,scope_company_id"
        ).fetchall()
        self.capture(self.acquire(), [self.item()])
        self.connection.commit()
        self.assertEqual(
            self.connection.execute(
                "select * from private.workspace_revision_tokens where source <> 'inventory' "
                "order by source,scope_company_id"
            ).fetchall(),
            before,
        )
