"""Tests for Data Kiosk Economics query construction."""

import unittest
from datetime import date

from ....src.amazon.data_kiosk import build_daily_msku_economics_query


class TestEconomicsQueryBuilder(unittest.TestCase):
    def test_builds_complete_pinned_day_msku_query(self) -> None:
        """Check the query requests every current daily SKU economics section."""
        query = build_daily_msku_economics_query(
            date(2026, 8, 1),
            date(2026, 8, 31),
            "ATVPDKIKX0DER",
        )

        self.assertIn("analytics_economics_2024_03_15", query)
        self.assertIn('startDate: "2026-08-01"', query)
        self.assertIn('endDate: "2026-08-31"', query)
        self.assertIn("aggregateBy: { date: DAY, productId: MSKU }", query)
        self.assertIn('marketplaceIds: ["ATVPDKIKX0DER"]', query)
        self.assertIn(
            "includeComponentsForFeeTypes: [FBA_FULFILLMENT_FEE, FBA_STORAGE_FEE]",
            query,
        )
        self.assertIn("childAsin", query)
        self.assertIn("fnsku", query)
        self.assertIn("parentAsin", query)
        self.assertIn("sales {", query)
        self.assertIn("averageSellingPrice { amount currencyCode }", query)
        self.assertIn("netProductSales { amount currencyCode }", query)
        self.assertIn("unitsOrdered", query)
        self.assertIn("unitsRefunded", query)
        self.assertIn("fees {\n        feeTypeName\n        charges {", query)
        self.assertIn("components {", query)
        self.assertIn("properties {", query)
        self.assertIn("amountPerUnit { amount currencyCode }", query)
        self.assertIn("amountPerUnitDelta { amount currencyCode }", query)
        self.assertIn("promotionAmount { amount currencyCode }", query)
        self.assertIn("taxAmount { amount currencyCode }", query)
        self.assertIn("quantity", query)
        self.assertIn("ads {\n        adTypeName\n        charge {", query)
        self.assertIn("totalAmount { amount currencyCode }", query)
        self.assertIn("cost {", query)
        self.assertIn("costOfGoodsSold { amount currencyCode }", query)
        self.assertIn("shippingToAmazonCost { amount currencyCode }", query)
        self.assertIn("fulfillmentCost { amount currencyCode }", query)
        self.assertIn("miscellaneousCost { amount currencyCode }", query)
        self.assertIn("netProceeds {", query)

    def test_rejects_reversed_dates_and_unsafe_marketplace_ids(self) -> None:
        """Check local validation before a query reaches Amazon."""
        with self.assertRaisesRegex(ValueError, "start_date"):
            build_daily_msku_economics_query(
                date(2026, 8, 2),
                date(2026, 8, 1),
                "ATVPDKIKX0DER",
            )

        with self.assertRaisesRegex(ValueError, "marketplace_id"):
            build_daily_msku_economics_query(
                date(2026, 8, 1),
                date(2026, 8, 2),
                'ATVPDKIKX0DER"] } mutation Unsafe {',
            )


if __name__ == "__main__":
    unittest.main()
