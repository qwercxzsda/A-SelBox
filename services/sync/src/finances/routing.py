"""Derive lookup keys solely from the transaction and its individual item."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from ..amazon.product_codes import validate_product
from ..reference.periods import shift_months
from ..transaction_types.finances import FinancesType
from .values import array, object_value, text, timestamp


@dataclass(frozen=True, slots=True)
class Route:
    name: str
    reference_id: str | None = None
    reference_month: date | None = None
    ledger_start: date | None = None
    ledger_end: date | None = None


def context(item: Mapping[str, object], kind: str) -> Mapping[str, object]:
    rows = [object_value(value) for value in array(item.get("contexts"))]
    matches = [row for row in rows if row.get("contextType") == kind]
    if len(matches) > 1:
        raise ValueError(f"Multiple {kind} contexts on a Finances item.")
    return matches[0] if matches else {}


def _item_ids(item: Mapping[str, object], name: str) -> set[str]:
    rows = (object_value(v) for v in array(item.get("relatedIdentifiers")))
    return {
        text(r["itemRelatedIdentifierValue"])
        for r in rows
        if r.get("itemRelatedIdentifierName") == name and r.get("itemRelatedIdentifierValue")
    }


def _unique(candidates: set[str]) -> str | None:
    if len(candidates) > 1:
        raise ValueError("Conflicting reference IDs on one Finances charge.")
    return next(iter(candidates), None)


def _shipment_id(links: Mapping[str, str], item: Mapping[str, object]) -> str | None:
    pattern = re.compile(r"FBA[A-Z0-9]{6,12}")
    candidates = {
        value
        for key in ("ORDER_ID", "SHIPMENT_ID")
        if (value := links.get(key)) and pattern.fullmatch(value)
    }
    for value in _item_ids(item, "TRANSACTION_ID"):
        candidates.update(part for part in value.split(":")[1:] if pattern.fullmatch(part))
    return _unique(candidates)


def charge_route(
    definition: FinancesType,
    item: Mapping[str, object],
    links: Mapping[str, str],
    *,
    liquidation: bool,
    sku: str | None,
    asin: str | None,
    posted: date,
    zone: ZoneInfo,
) -> Route:
    route = definition.route
    month = posted.replace(day=1)
    if liquidation:
        if sku is None or asin is not None:
            raise ValueError("Liquidation requires an FNSKU in the item SKU field.")
        validate_product(fnsku=sku)
        return Route("FNSKU", ledger_start=shift_months(month, -6), ledger_end=month)
    validate_product(sku=sku, asin=asin)
    if definition.route == "SKU":
        if sku is None:
            raise ValueError("Allocated Finances component lacks a source SKU.")
        return Route("SKU")
    if sku is not None:
        raise ValueError("Unexpected SKU on an account or reference charge.")
    if definition.route == "SELBOX":
        return Route("SELBOX")
    if route == "ASIN":
        if asin is None:
            raise ValueError("Returns processing fee requires a product ASIN.")
        period = context(item, "TimeRangeContext")
        begin, end = timestamp(period.get("startTime")), timestamp(period.get("endTime"))
        if end < begin:
            raise ValueError("Reversed returns fee period.")
        return Route(
            "ASIN",
            ledger_start=begin.astimezone(zone).date().replace(day=1),
            ledger_end=end.astimezone(zone).date().replace(day=1),
        )
    order = links.get("ORDER_ID")
    if route == "PROMOTION":
        return Route(route, order)
    if route == "SHIPMENT":
        return Route("SHIPMENT", _shipment_id(links, item))
    if route == "REMOVAL_ORDER":
        customer = order and re.fullmatch(r"[0-9]{3}-[0-9]{7}-[0-9]{7}", order)
        return Route("CUSTOMER_ORDER" if customer else "REMOVAL_ORDER", order)
    if route == "AD_INVOICE":
        return Route("AD_INVOICE", _unique(_item_ids(item, "INVOICE_ID")))
    if route == "STORAGE" and posted.day <= 10:
        return Route("STORAGE", reference_month=(month - timedelta(days=1)).replace(day=1))
    if route == "AGED_STORAGE" and posted.day >= 11:
        return Route("AGED_STORAGE", reference_month=month)
    raise ValueError("Unrecognized fee route or storage posting date.")


def amount_part(component_type: str, path: tuple[str, ...]) -> str:
    if path and path[-1] == "Promo":
        return "PROMO"
    if (path and ("Tax" in (path[0], path[-1]))) or component_type == "TAX_RECLASSIFICATION":
        return "TAX"
    return "BASE"
