"""Precision and coverage rules that affect company payouts."""

import unittest
from datetime import date
from decimal import Decimal
from typing import cast

from services.sync.src.reference.invoices import invoice_rows
from services.sync.src.reference.periods import shift_months
from services.sync.src.reference.taxes import finance_rate, report_tax
from services.sync.tests.support.currencies import CURRENCY_DECIMALS


class SourceCostTests(unittest.TestCase):
    def test_invoice_preserves_fractional_tax_for_each_campaign_and_adjustment(self) -> None:
        def money(amount: str) -> dict[str, str]:
            return {"amount": amount, "currencyCode": "SGD"}

        answer = {
            "invoiceSummary": {
                "id": "I",
                "amountDue": money("0.11"),
                "taxRate": 1000,
                "taxAmountDue": money("0.01"),
                "status": "PAID_IN_FULL",
                "invoiceDate": "20260302",
                "fromDate": "20260201",
                "toDate": "20260228",
            },
            "invoiceLines": [
                {
                    "campaignId": 1,
                    "campaignName": "C",
                    "programName": "SPONSORED PRODUCTS",
                    "cost": money("0.14"),
                }
            ],
            "adjustments": [
                {
                    "description": "Over Delivery Adjustment Applied Against Campaign: C",
                    "amount": money("-0.03"),
                }
            ],
            "promotions": [],
            "taxDetail": {
                "taxBreakups": [
                    {"taxRate": 1000, "taxName": "VAT", "taxedJurisdictionName": "SOUTH KOREA"}
                ]
            },
        }
        invoice = invoice_rows(answer, "I", "123", CURRENCY_DECIMALS)
        self.assertEqual(invoice["tax_rate_percent"], 10)
        self.assertEqual(invoice["tax_country"], "SOUTH KOREA")
        rows = cast(list[dict[str, object]], invoice["rows"])
        self.assertEqual([r["tax_amount"] for r in rows], [Decimal("0.014"), Decimal("-0.003")])
        self.assertEqual([r["campaign_id"] for r in rows], ["1", "1"])
        with self.assertRaisesRegex(ValueError, "registry"):
            invoice_rows(answer, "I", "123", {"JPY": 0})

    def test_singapore_removal_includes_tax_and_aged_storage_excludes_tax(self) -> None:
        self.assertEqual(
            report_tax(
                "SINGAPORE", "REMOVAL_ORDER", None, "SGD", Decimal("11.45"), CURRENCY_DECIMALS
            ),
            (Decimal("10.50"), Decimal("0.95")),
        )
        self.assertEqual(
            report_tax("SINGAPORE", "AGED_STORAGE", "SG", "SGD", Decimal("5.5"), CURRENCY_DECIMALS),
            (Decimal("5.50"), Decimal("0.50")),
        )
        with self.assertRaisesRegex(ValueError, "currency pair"):
            report_tax("SINGAPORE", "AGED_STORAGE", "SG", "USD", Decimal("1"), CURRENCY_DECIMALS)
        with self.assertRaisesRegex(ValueError, "No observed tax"):
            report_tax("EU", "AGED_STORAGE", "FR", "EUR", Decimal("1"), CURRENCY_DECIMALS)
        self.assertEqual(
            report_tax("EU", "AGED_STORAGE", "ES", "EUR", Decimal(0), CURRENCY_DECIMALS), (0, 0)
        )

    def test_observed_french_inbound_transport_charge_has_zero_tax(self) -> None:
        self.assertEqual(finance_rate("Amazon.fr", "INBOUND_TRANSPORTATION_FEES"), Decimal("0"))
        with self.assertRaisesRegex(ValueError, "No observed tax"):
            finance_rate("Amazon.fr", "INBOUND_TRANSPORTATION_PROGRAM_FEES")

    def test_clamps_calendar_windows_at_month_end(self) -> None:
        self.assertEqual(shift_months(date(2024, 5, 31), -3), date(2024, 2, 29))
        self.assertEqual(shift_months(date(2024, 2, 29), -12), date(2023, 2, 28))
