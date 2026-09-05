"""Tests for assembling a complete in-memory provision refresh."""

import unittest
from datetime import UTC, date, datetime

from ....src.data_kiosk_economics.acquisition import MarketplaceProvisionData
from ....src.data_kiosk_economics.processing import build_data_kiosk_provision_refresh
from ...support.economics import complete_economics_fact

US_MARKETPLACE_ID = "ATVPDKIKX0DER"
CA_MARKETPLACE_ID = "A2EUQ1WTGCTBG2"
REFRESHED_AT = datetime(2026, 8, 3, tzinfo=UTC)


class TestProvisionRefreshConstruction(unittest.TestCase):
    def test_combines_every_selected_marketplace(self) -> None:
        us_fact = complete_economics_fact()
        ca_fact = complete_economics_fact(
            marketplace_id=CA_MARKETPLACE_ID,
            sku="SKU-CA",
        )

        refresh = build_data_kiosk_provision_refresh(
            (
                MarketplaceProvisionData(
                    marketplace_id=US_MARKETPLACE_ID,
                    query_start_date=date(2026, 8, 1),
                    query_end_date=date(2026, 8, 2),
                    facts=(us_fact,),
                ),
                MarketplaceProvisionData(
                    marketplace_id=CA_MARKETPLACE_ID,
                    query_start_date=date(2026, 8, 1),
                    query_end_date=date(2026, 8, 2),
                    facts=(ca_fact,),
                ),
            ),
            seller_namespace="seller-na",
            amazon_scope="NA",
            refreshed_at=REFRESHED_AT,
        )

        self.assertEqual(refresh.marketplace_ids, (US_MARKETPLACE_ID, CA_MARKETPLACE_ID))
        self.assertEqual(refresh.facts, (us_fact, ca_fact))

    def test_preserves_an_empty_success_for_a_marketplace(self) -> None:
        refresh = build_data_kiosk_provision_refresh(
            (
                MarketplaceProvisionData(
                    marketplace_id=US_MARKETPLACE_ID,
                    query_start_date=date(2026, 8, 1),
                    query_end_date=date(2026, 8, 2),
                    facts=(),
                ),
            ),
            seller_namespace="seller-na",
            amazon_scope="NA",
            refreshed_at=REFRESHED_AT,
        )

        self.assertEqual(refresh.marketplace_ids, (US_MARKETPLACE_ID,))
        self.assertEqual(refresh.facts, ())

    def test_coverage_can_include_a_marketplace_with_no_active_result(self) -> None:
        refresh = build_data_kiosk_provision_refresh(
            (
                MarketplaceProvisionData(
                    marketplace_id=US_MARKETPLACE_ID,
                    query_start_date=date(2026, 8, 1),
                    query_end_date=date(2026, 8, 2),
                    facts=(),
                ),
            ),
            seller_namespace="seller-na",
            amazon_scope="NA",
            refreshed_at=REFRESHED_AT,
            covered_marketplace_ids=(US_MARKETPLACE_ID, CA_MARKETPLACE_ID),
        )

        self.assertEqual(refresh.marketplace_ids, (US_MARKETPLACE_ID, CA_MARKETPLACE_ID))
        self.assertEqual(refresh.facts, ())

    def test_rejects_a_result_outside_the_covered_marketplaces(self) -> None:
        result = MarketplaceProvisionData(
            marketplace_id=CA_MARKETPLACE_ID,
            query_start_date=date(2026, 8, 1),
            query_end_date=date(2026, 8, 2),
            facts=(),
        )

        with self.assertRaisesRegex(ValueError, "covered marketplace scope"):
            build_data_kiosk_provision_refresh(
                (result,),
                seller_namespace="seller-na",
                amazon_scope="NA",
                refreshed_at=REFRESHED_AT,
                covered_marketplace_ids=(US_MARKETPLACE_ID,),
            )

    def test_rejects_a_noncanonical_msku_before_database_work(self) -> None:
        result = MarketplaceProvisionData(
            marketplace_id=US_MARKETPLACE_ID,
            query_start_date=date(2026, 8, 1),
            query_end_date=date(2026, 8, 2),
            facts=(complete_economics_fact(sku=" SKU-1 "),),
        )

        with self.assertRaisesRegex(ValueError, "canonical nonblank MSKU"):
            build_data_kiosk_provision_refresh(
                (result,),
                seller_namespace="seller-na",
                amazon_scope="NA",
                refreshed_at=REFRESHED_AT,
            )

    def test_rejects_missing_or_duplicate_marketplace_results(self) -> None:
        result = MarketplaceProvisionData(
            marketplace_id=US_MARKETPLACE_ID,
            query_start_date=date(2026, 8, 1),
            query_end_date=date(2026, 8, 2),
            facts=(),
        )
        for values in ((), (result, result)):
            with self.subTest(values=values), self.assertRaises(ValueError):
                build_data_kiosk_provision_refresh(
                    values,
                    seller_namespace="seller-na",
                    amazon_scope="NA",
                    refreshed_at=REFRESHED_AT,
                )


if __name__ == "__main__":
    unittest.main()
