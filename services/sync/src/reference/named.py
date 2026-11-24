"""Download and independently preprocess named source archives."""

import json
from collections.abc import Mapping
from decimal import Decimal

from ..amazon.marketplace_names import marketplace_name_from_id
from ..finances.values import array, object_value, text
from .invoices import invoice_rows
from .named_information import campaign_info, promotion_info, shipment_info


def _body(raw: object) -> Mapping[str, object]:
    obj = object_value(json.loads(text(raw), parse_float=Decimal))
    if obj.get("errors"):
        raise ValueError("Amazon returned an error in a named source.")
    return object_value(obj.get("payload", obj))


def _rows(raw: Mapping[str, object], key: str) -> list[Mapping[str, object]]:
    if not isinstance(raw[key], list):
        raise ValueError("Amazon response requires a list of rows.")
    return [object_value(i) for i in array(raw[key])]


def prepare_named(
    source: str,
    raw: bytes,
    marketplace_id: str,
    native_id: str,
    currency_decimals: Mapping[str, int],
) -> dict[str, object] | None:
    bundle = object_value(json.loads(raw))
    if (bundle["source"], bundle["marketplace_id"], bundle["native_id"]) != (
        source,
        marketplace_id,
        native_id,
    ):
        raise ValueError("Named source archive differs from its declared request.")
    if bundle.get("missing") is True:
        return None
    if source == "CAMPAIGN":
        campaigns, ads = (
            [row for page in array(bundle[key]) for row in _rows(_body(page), key)]
            for key in ("campaigns", "ads")
        )
        if not campaigns and not ads:
            return None
        if len(campaigns) != 1:
            raise ValueError("Campaign query must identify one campaign.")
        result = campaign_info(
            campaigns[0],
            ads,
            native_id,
            text(bundle["lookup_id"]),
            text(bundle["ad_type"]),
        )
    elif source == "AD_INVOICE":
        result = invoice_rows(
            _body(bundle["body"]), native_id, text(bundle["profile_id"]), currency_decimals
        )
    elif source == "PROMOTION":
        result = promotion_info(_body(bundle["body"]), marketplace_id, native_id)
    elif source == "SHIPMENT":
        shipments = _rows(_body(bundle["body"]), "ShipmentData")
        if not shipments:
            return None
        if len(shipments) != 1:
            raise ValueError("Inbound lookup must identify one shipment.")
        items = [row for page in array(bundle["items"]) for row in _rows(_body(page), "ItemData")]
        result = shipment_info(shipments[0], items, native_id)
    else:
        raise ValueError("Unsupported named source.")
    if source != "SHIPMENT":
        result["marketplace_name"] = marketplace_name_from_id(marketplace_id)
    return result
