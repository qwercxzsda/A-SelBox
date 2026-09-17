"""Validate reviewed coverage and the existing zero-net retrocharge event contract."""

from collections import defaultdict
from collections.abc import Sequence

from ..numeric import ZERO
from .models import SettlementTransaction

RETROCHARGE_COMPONENTS = {
    ("ItemPrice", "Tax"): "principal",
    ("ItemPrice", "ShippingTax"): "shipping",
    ("ItemWithheldTax", "MarketplaceFacilitatorTax-Principal"): "principal",
    ("ItemWithheldTax", "MarketplaceFacilitatorTax-Shipping"): "shipping",
    ("ItemWithheldTax", "MarketplaceFacilitatorVAT-Principal"): "principal",
    ("ItemWithheldTax", "MarketplaceFacilitatorVAT-Shipping"): "shipping",
}


def validate_retrocharge_groups(
    rows: Sequence[SettlementTransaction],
    complete_groups: tuple[tuple[int, ...], ...],
) -> None:
    """Require a reviewed complete line inventory and independently validate each event.

    A complete archived report alone cannot prove that a retrocharge event never
    crosses a report boundary. The caller supplies reviewed source-line groups;
    zero alone is insufficient. Cross-report groups cannot publish a partial report.
    """
    by_identity: defaultdict[tuple[object, ...], list[SettlementTransaction]] = defaultdict(list)
    for row in rows:
        if row.family != "F7":
            continue
        order_id = row.source_fields["order-id"].strip()
        if not order_id:
            raise ValueError("F7 requires an identifiable order.")
        key = (
            row.currency,
            row.transaction_type,
            order_id,
            row.source_fields["adjustment-id"].strip() or None,
            row.posted_at,
        )
        by_identity[key].append(row)
    inventories = tuple(frozenset(group) for group in complete_groups)
    if any(
        not group
        or len(group) != len(set(group))
        or any(type(line) is not int or line < 1 for line in group)
        for group in complete_groups
    ):
        raise ValueError("Retrocharge coverage must contain nonempty unique source-line groups.")
    all_lines = {line for group in inventories for line in group}
    if sum(map(len, inventories)) != len(all_lines):
        raise ValueError("Retrocharge coverage groups overlap.")
    actual = {frozenset(row.source_line_number for row in group) for group in by_identity.values()}
    if actual != set(inventories):
        raise ValueError("F7 requires reviewed complete retrocharge source coverage.")
    for group in by_identity.values():
        by_tax: defaultdict[str, list[SettlementTransaction]] = defaultdict(list)
        for row in group:
            by_tax[RETROCHARGE_COMPONENTS[(row.amount_type, row.amount_description)]].append(row)
        for pair in by_tax.values():
            if len(pair) != 2 or {row.amount_type for row in pair} != {
                "ItemPrice",
                "ItemWithheldTax",
            }:
                raise ValueError("F7 tax/withholding pair is incomplete or ambiguous.")
        if sum((row.amount for row in group), ZERO) != ZERO:
            raise ValueError("F7 retrocharge group must have an exact zero net amount.")
