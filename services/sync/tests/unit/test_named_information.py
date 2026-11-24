"""Reject incomplete information responses before they can replace accepted product lists."""

import unittest

from services.sync.src.reference.named_information import (
    campaign_info,
    promotion_info,
    shipment_info,
)


class NamedInformationTests(unittest.TestCase):
    def test_sponsored_product_must_name_both_product_identifiers(self) -> None:
        campaign = {
            "campaignId": "1",
            "name": "campaign",
            "state": "ENABLED",
            "adProduct": "SPONSORED_PRODUCTS",
        }
        for sku, asin in ((None, "B000000011"), ("sku", None)):
            creative = {
                "productCreativeSettings": {
                    "advertisedProduct": {
                        "productIdType": "SKU",
                        "resolvedProductIdType": "ASIN",
                        "productId": sku,
                        "resolvedProductId": asin,
                    }
                }
            }
            ad = {"campaignId": "1", "creative": {"productCreative": creative}}
            with self.subTest(sku=sku, asin=asin), self.assertRaises(ValueError):
                campaign_info(campaign, [ad], "1", "1", "SPONSORED_PRODUCTS")
        with self.assertRaisesRegex(ValueError, "billed ID"):
            campaign_info(campaign, [], "unrelated", "1", "SPONSORED_PRODUCTS")

    def test_shipment_sku_and_fnsku_are_both_required(self) -> None:
        shipment = {"ShipmentId": "FBA1", "ShipmentName": "shipment", "ShipmentStatus": "CLOSED"}
        with self.assertRaises(ValueError):
            shipment_info(
                shipment,
                [{"ShipmentId": "FBA1", "SellerSKU": "sku", "FulfillmentNetworkSKU": None}],
                "FBA1",
            )

    def test_promotion_always_names_an_asin(self) -> None:
        promotion = {
            "promotionId": "p1",
            "marketplaceId": "m1",
            "selection": {
                "type": "ITEMS",
                "selectionDetails": {"items": [{"asin": None, "sku": "sku"}]},
            },
            "schedule": {"startDate": "2026-08-01", "endDate": "2026-08-02"},
            "promotionTitle": "coupon",
            "promotionType": "COUPON",
            "status": "EXPIRED",
        }
        with self.assertRaises(ValueError):
            promotion_info(promotion, "m1", "p1")
