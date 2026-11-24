"""Read the products Amazon actually lists for one campaign, promotion or shipment."""

from collections.abc import Mapping
from datetime import datetime

from ..amazon.product_codes import validate_product
from ..finances.values import array, object_value, text
from .invoices import identifier

CREATIVES = {
    "SPONSORED_PRODUCTS": {"productCreative": {"productCreativeSettings"}},
    "SPONSORED_DISPLAY": {
        "componentCreative": {"responsiveEcommerceSettings", "productVideoSettings"}
    },
    "SPONSORED_BRANDS": {
        "componentCreative": {"productCollectionSettings", "productVideoSettings"}
    },
    "SPONSORED_TV": {"videoCreative": {"streamingTvSettings"}},
}


def _product(sku: object = None, asin: object = None, fnsku: object = None) -> dict[str, object]:
    s, a, f = (None if value is None else text(value) for value in (sku, asin, fnsku))
    if s is None and a is None:
        raise ValueError("Missing product identifiers.")
    validate_product(s, a, f)
    return {"sku": s, "fnsku": f} if f else {"sku": s, "asin": a}


def _products(ad: Mapping[str, object], ad_type: str) -> list[dict[str, object]]:
    creative = object_value(ad["creative"])
    if len(creative) != 1:
        raise ValueError("Expected a single advertising creative.")
    kind, settings = next(iter(creative.items()))
    allowed = CREATIVES[ad_type].get(kind, set())
    values = object_value(settings)
    if len(values) != 1 or not set(values) <= allowed:
        raise ValueError("Unsupported advertising creative settings.")
    body = object_value(next(iter(values.values())))
    if ad_type == "SPONSORED_TV":
        return []
    if ad_type == "SPONSORED_PRODUCTS":
        prod = object_value(body["advertisedProduct"])
        if (prod["productIdType"], prod["resolvedProductIdType"]) != ("SKU", "ASIN"):
            raise ValueError("Unsupported Sponsored Products identifier types.")
        return [_product(text(prod["productId"]), text(prod["resolvedProductId"]))]
    products = [object_value(row) for row in array(body["products"])]
    expected = "SKU" if ad_type == "SPONSORED_DISPLAY" else "ASIN"
    if any(row["productIdType"] != expected for row in products):
        raise ValueError("Unsupported advertising product identifier type.")
    return [_product(**{expected.lower(): row["productId"]}) for row in products]


def campaign_info(
    campaign: Mapping[str, object],
    ads: list[Mapping[str, object]],
    native_id: str,
    lookup_id: str,
    ad_type: str,
) -> dict[str, object]:
    if ad_type != "SPONSORED_TV" and lookup_id != native_id:
        raise ValueError("Campaign lookup differs from its billed ID.")
    if identifier(campaign["campaignId"]) != lookup_id or any(
        identifier(ad["campaignId"]) != lookup_id for ad in ads
    ):
        raise ValueError("Ads query returned a different campaign.")
    expected_program = "SPONSORED_TELEVISION" if ad_type == "SPONSORED_TV" else ad_type
    if campaign["adProduct"] != expected_program:
        raise ValueError("Campaign program differs from the request.")
    return {
        "campaign_id": native_id,
        "campaign_aid": lookup_id if ad_type == "SPONSORED_TV" else None,
        "ad_program": ad_type,
        "campaign_name": text(campaign["name"]),
        "campaign_state": campaign["state"],
        "start_date": datetime.fromisoformat(text(campaign["startDateTime"])).date()
        if campaign.get("startDateTime")
        else None,
        "end_date": datetime.fromisoformat(text(campaign["endDateTime"])).date()
        if campaign.get("endDateTime")
        else None,
        "rows": [row for ad in ads for row in _products(ad, ad_type)],
    }


def promotion_info(
    promotion: Mapping[str, object], marketplace_id: str, native_id: str
) -> dict[str, object]:
    if promotion["promotionId"] != native_id or promotion["marketplaceId"] != marketplace_id:
        raise ValueError("Promotion does not match the requested ID and marketplace.")
    selection = object_value(promotion["selection"])
    details = object_value(selection["selectionDetails"])
    if selection["type"] != "ITEMS" or details.get("pagination") or promotion.get("pagination"):
        raise ValueError("Incomplete or unsupported promotion selection.")
    schedule = object_value(promotion["schedule"])
    items = [object_value(row) for row in array(details["items"])]
    return {
        "promotion_id": native_id,
        "promotion_title": text(promotion["promotionTitle"]),
        "promotion_type": promotion["promotionType"],
        "promotion_status": promotion["status"],
        "starts_at": schedule["startDate"],
        "ends_at": schedule["endDate"],
        "rows": [_product(row.get("sku"), text(row["asin"])) for row in items],
    }


def shipment_info(
    shipment: Mapping[str, object], items: list[Mapping[str, object]], native_id: str
) -> dict[str, object]:
    if shipment["ShipmentId"] != native_id or any(row["ShipmentId"] != native_id for row in items):
        raise ValueError("Inbound shipment differs from the requested ID.")
    return {
        "shipment_id": native_id,
        "shipment_name": text(shipment["ShipmentName"]),
        "shipment_status": shipment["ShipmentStatus"],
        "destination_fulfillment_center": shipment.get("DestinationFulfillmentCenterId"),
        "rows": [
            {
                **_product(text(row["SellerSKU"]), fnsku=text(row["FulfillmentNetworkSKU"])),
                "quantity_shipped": row.get("QuantityShipped"),
                "quantity_received": row.get("QuantityReceived"),
            }
            for row in items
        ],
    }
