"""Validate source categories and normalize optional inventory estimates."""

import re
from collections.abc import Mapping
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Literal

from .vocabulary import HEALTH_STATUSES, RECOMMENDED_ACTIONS

type MetricKind = Literal[
    "units", "decimal", "date", "currency", "health_status", "recommended_action"
]
_CATEGORICAL_VALUES: dict[str, tuple[str, ...]] = {
    "health_status": HEALTH_STATUSES,
    "recommended_action": RECOMMENDED_ACTIONS,
}
FIELD_MAP: tuple[tuple[str, str, MetricKind], ...] = (
    ("snapshot_date", "snapshot-date", "date"),
    ("available_quantity", "available", "units"),
    ("fba_supply_quantity", "Inventory Supply at FBA", "units"),
    ("inbound_quantity", "inbound-quantity", "units"),
    ("inbound_working_quantity", "inbound-working", "units"),
    ("inbound_shipped_quantity", "inbound-shipped", "units"),
    ("inbound_received_quantity", "inbound-received", "units"),
    ("reserved_quantity", "Total Reserved Quantity", "units"),
    ("reserved_transfer_quantity", "fc-transfer", "units"),
    ("reserved_processing_quantity", "Reserved FC Processing", "units"),
    ("reserved_customer_order_quantity", "Reserved Customer Order", "units"),
    ("unfulfillable_quantity", "unfulfillable-quantity", "units"),
    ("sales_amount_90d", "sales-shipped-last-90-days", "decimal"),
    ("units_shipped_90d", "units-shipped-t90", "units"),
    ("currency", "currency", "currency"),
    ("health_status", "fba-inventory-level-health-status", "health_status"),
    ("minimum_inventory_units", "fba-minimum-inventory-level", "units"),
    ("days_of_supply", "days-of-supply", "decimal"),
    (
        "total_days_of_supply",
        "Total Days of Supply (including units from open shipments)",
        "decimal",
    ),
    ("recommended_ship_in_units", "Recommended ship-in quantity", "units"),
    ("recommended_ship_in_date", "Recommended ship-in date", "date"),
    ("recommended_action", "recommended-action", "recommended_action"),
)

_NUMBER = re.compile(r"[+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?")
_MISSING = frozenset({"", "-", "--", "n/a", "na", "null", "not applicable"})
_MAX_BIGINT = 9_223_372_036_854_775_807


def prepare_inventory_item(
    source: Mapping[str, str], line: int, diagnostics: list[Mapping[str, object]]
) -> dict[str, object]:
    """Reject unknown categories; retain usable estimates, exact SKU, and source line."""
    item: dict[str, object] = {"sku": source["sku"], "source_line_number": line}
    for target, field, kind in FIELD_MAP:
        try:
            item[target] = parse_metric(source.get(field.casefold(), ""), kind)
        except ValueError:
            if kind in _CATEGORICAL_VALUES:
                raise ValueError(
                    f"Inventory report has an unsupported {field} at source line {line}."
                ) from None
            item[target] = None
            diagnostics.append(
                {"code": "INVALID_OPTIONAL_METRIC", "field": field, "source_line_number": line}
            )
    if item["sales_amount_90d"] is not None and item["currency"] is None:
        item["sales_amount_90d"] = None
        diagnostics.append({"code": "SALES_WITHOUT_CURRENCY", "source_line_number": line})
    return item


def parse_metric(value: str, kind: MetricKind) -> object:
    """Return NULL for missing values and reject unsupported source categories."""
    cleaned = value.strip()
    if cleaned.casefold() in _MISSING:
        return None
    if kind in _CATEGORICAL_VALUES:
        if cleaned not in _CATEGORICAL_VALUES[kind]:
            raise ValueError("Unsupported inventory source category.")
        return cleaned
    if kind == "currency":
        if re.fullmatch(r"[A-Z]{3}", cleaned) is None:
            raise ValueError("Invalid currency.")
        return cleaned
    if kind == "date":
        if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", cleaned) is None:
            raise ValueError("Invalid calendar date.")
        return date.fromisoformat(cleaned)
    if _NUMBER.fullmatch(cleaned) is None:
        raise ValueError("Invalid numeric value.")
    try:
        number = Decimal(cleaned.replace(",", ""))
    except InvalidOperation:
        raise ValueError("Invalid numeric value.") from None
    if not number.is_finite():
        raise ValueError("Nonfinite numeric value.")
    if kind == "units":
        if number < 0 or number > _MAX_BIGINT or number != number.to_integral_value():
            raise ValueError("Units require nonnegative bigint values.")
        return int(number)
    return number
