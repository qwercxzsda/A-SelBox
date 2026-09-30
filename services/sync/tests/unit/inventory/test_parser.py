"""Daily snapshots preserve exact source identities and tolerate unavailable estimates."""

import unittest
from datetime import date
from decimal import Decimal

from services.sync.src.inventory.parser import prepare_inventory_report

from .fixtures import MARKETPLACE, report_bytes


class InventoryParserTests(unittest.TestCase):
    def test_values_dates_and_actual_transfer_field_are_preserved(self) -> None:
        prepared = prepare_inventory_report(
            report_bytes(
                {
                    "sku": "  AbC  ",
                    "available": "0",
                    "Inventory Supply at FBA": "1234",
                    "inbound-received": "2",
                    "fc-transfer": "3",
                    "currency": "USD",
                    "sales-shipped-last-90-days": "1,234.50",
                    "units-shipped-t90": "100",
                    "snapshot-date": "2026-09-20",
                    "Recommended ship-in date": "2026-10-02",
                    "fba-inventory-level-health-status": "New Amazon label",
                    "recommended-action": "A future action",
                    "marketplace": "US",
                }
            ),
            marketplace_id=MARKETPLACE,
        )
        row = prepared.items[0]
        self.assertEqual(row["sku"], "  AbC  ")
        self.assertEqual(row["source_line_number"], 2)
        self.assertEqual(row["available_quantity"], 0)
        self.assertEqual(row["reserved_transfer_quantity"], 3)
        self.assertEqual(row["inbound_received_quantity"], 2)
        self.assertEqual(row["sales_amount_90d"], Decimal("1234.50"))
        self.assertEqual(row["snapshot_date"], date(2026, 9, 20))
        self.assertEqual(row["recommended_ship_in_date"], date(2026, 10, 2))
        self.assertEqual(row["health_status"], "New Amazon label")
        self.assertIsNone(row["unfulfillable_quantity"])

    def test_documented_transfer_alias_matches_actual_source_without_ambiguity(self) -> None:
        for field in ("fc-transfer", "Reserved FC Transfer"):
            with self.subTest(field=field):
                result = prepare_inventory_report(
                    report_bytes({"sku": "sku", field: "3"}), marketplace_id=MARKETPLACE
                )
                self.assertEqual(result.items[0]["reserved_transfer_quantity"], 3)
        with self.assertRaisesRegex(ValueError, "unambiguous headers"):
            prepare_inventory_report(
                report_bytes({"sku": "sku", "fc-transfer": "1", "Reserved FC Transfer": "2"}),
                marketplace_id=MARKETPLACE,
            )

    def test_bad_optional_metrics_become_null_without_losing_other_stock(self) -> None:
        for value in ("-1", "1.25", "NaN", "Infinity", "1e999999", "9223372036854775808"):
            with self.subTest(value=value):
                result = prepare_inventory_report(
                    report_bytes(
                        {
                            "sku": "sku",
                            "available": value,
                            "inbound-working": "4",
                            "snapshot-date": "not-date",
                            "currency": "bad-value",
                            "sales-shipped-last-90-days": "1.1",
                        }
                    ),
                    marketplace_id=MARKETPLACE,
                )
                self.assertIsNone(result.items[0]["available_quantity"])
                self.assertIsNone(result.items[0]["snapshot_date"])
                self.assertIsNone(result.items[0]["sales_amount_90d"])
                self.assertEqual(result.items[0]["inbound_working_quantity"], 4)
                self.assertIn("SALES_WITHOUT_CURRENCY", [d["code"] for d in result.diagnostics])

    def test_identical_duplicates_collapse_conflicts_disappear_case_remains_distinct(self) -> None:
        result = prepare_inventory_report(
            report_bytes(
                {"sku": "keep", "available": "2"},
                {"sku": "keep", "available": "2"},
                {"sku": "conflict", "available": "3"},
                {"sku": "conflict", "available": "4"},
                {"sku": "conflict", "available": "3"},
                {"sku": "Keep", "available": "5"},
                {"sku": "  ", "available": "9"},
            ),
            marketplace_id=MARKETPLACE,
        )
        self.assertEqual([row["sku"] for row in result.items], ["keep", "Keep"])
        self.assertIn("CONFLICTING_DUPLICATE_SKU", [d["code"] for d in result.diagnostics])

    def test_empty_capture_is_distinct_from_unusable_nonempty_document(self) -> None:
        result = prepare_inventory_report(
            report_bytes(columns=("sku", "available")), marketplace_id=MARKETPLACE
        )
        self.assertEqual(result.items, ())
        for content in (
            report_bytes({"sku": "", "available": "2"}),
            report_bytes({"sku": "a", "available": "1"}, {"sku": "a", "available": "2"}),
            b"",
            b"sku\n",
            b"sku\tsku\tavailable\n",
            b"sku\tavailable\nitem\t1\textra\n",
            b'sku\tavailable\n"unterminated\t1\n',
            b"\xffbad bytes",
        ):
            with self.subTest(content_type=content[:12]), self.assertRaises(ValueError):
                prepare_inventory_report(content, marketplace_id=MARKETPLACE)

    def test_wrong_marketplace_fails_whole_capture(self) -> None:
        with self.assertRaisesRegex(ValueError, "marketplace"):
            prepare_inventory_report(
                report_bytes(
                    {"sku": "first", "available": "1", "marketplace": "US"},
                    {"sku": "second", "available": "1", "marketplace": "CA"},
                ),
                marketplace_id=MARKETPLACE,
            )

    def test_bom_and_quoted_skus_do_not_change_identity(self) -> None:
        document = report_bytes({"sku": 'quote"and\ttab', "available": "1"}).decode()
        for content in (document.encode("utf-8-sig"), document.encode("utf-16")):
            with self.subTest(encoding=content[:2]):
                result = prepare_inventory_report(content, marketplace_id=MARKETPLACE)
                self.assertEqual(result.items[0]["sku"], 'quote"and\ttab')
