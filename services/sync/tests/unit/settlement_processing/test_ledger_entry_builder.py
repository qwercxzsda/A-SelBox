"""Tests for typed Settlement entry construction."""

import unittest
from dataclasses import replace
from datetime import UTC, date, datetime

from ....src.numeric import Numeric
from ....src.settlement_processing.ledger_entry_builder import (
    UnrecognizedMarketplaceError,
    build_ledger_entry,
)
from ....src.settlement_processing.models import SettlementSourceLine


def _source_line() -> SettlementSourceLine:
    return SettlementSourceLine(
        settlement_report_line_id="line-1",
        source_line_number=3,
        transaction_type="Order",
        amazon_order_id="order-1",
        merchant_order_id=None,
        amazon_adjustment_id="adjustment-1",
        amazon_shipment_id=None,
        marketplace_name="Amazon.com",
        amount_type="ItemPrice",
        amount_description="Principal",
        settlement_amount=Numeric("12.50"),
        fulfillment_id=None,
        posted_date=date(2026, 8, 20),
        posted_at=datetime(2026, 8, 20, 1, 2, 3, tzinfo=UTC),
        amazon_order_item_id="item-1",
        merchant_order_item_id=None,
        merchant_adjustment_item_id=None,
        amz_sku="SKU-1",
        quantity=2,
        promotion_id=None,
    )


class TestLedgerEntryBuilder(unittest.TestCase):
    def test_uses_report_marketplace_mapping(self) -> None:
        entry = build_ledger_entry(
            _source_line(),
            "settlement-1",
            {"Amazon.com": ("ATVPDKIKX0DER",)},
            settlement_currency="USD",
            ledger_entry_id="ledger-1",
            default_marketplace_id="A2EUQ1WTGCTBG2",
        )

        self.assertEqual(entry.marketplace_id, "ATVPDKIKX0DER")
        self.assertEqual(entry.settlement_amount, Numeric("12.50"))
        self.assertEqual(entry.quantity, 2)
        self.assertEqual(entry.amazon_adjustment_id, "adjustment-1")

    def test_unrecognized_marketplace_is_rejected_even_with_a_default(self) -> None:
        source_line = replace(_source_line(), marketplace_name="Unknown Marketplace")
        for default_marketplace_id in (None, "ATVPDKIKX0DER"):
            with (
                self.subTest(default_marketplace_id=default_marketplace_id),
                self.assertRaises(UnrecognizedMarketplaceError) as raised,
            ):
                build_ledger_entry(
                    source_line,
                    "settlement-1",
                    {"Amazon.com": ("ATVPDKIKX0DER",)},
                    settlement_currency="USD",
                    ledger_entry_id="ledger-1",
                    default_marketplace_id=default_marketplace_id,
                )

            self.assertEqual(raised.exception.source_line_number, 3)
            self.assertIn("unrecognized marketplace-name", str(raised.exception))

    def test_blank_marketplace_uses_only_the_explicit_default(self) -> None:
        source_line = replace(_source_line(), marketplace_name=None)
        for default_marketplace_id in (None, "ATVPDKIKX0DER"):
            with self.subTest(default_marketplace_id=default_marketplace_id):
                entry = build_ledger_entry(
                    source_line,
                    "settlement-1",
                    {"Amazon.com": ("ATVPDKIKX0DER",)},
                    settlement_currency="USD",
                    ledger_entry_id="ledger-1",
                    default_marketplace_id=default_marketplace_id,
                )

                self.assertIsNone(entry.marketplace_name)
                self.assertEqual(entry.marketplace_id, default_marketplace_id)


if __name__ == "__main__":
    unittest.main()
