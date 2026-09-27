"""Admit only registered Settlement types and preserve source-family invariants."""

from collections.abc import Mapping

from ..allocation import AllocationCategory
from ..transaction_types.settlement import SETTLEMENT_TYPE_BY_SOURCE


class UnknownSettlementTypeError(ValueError):
    """Reject unreviewed combinations before publishing any rows from a report."""

    def __init__(self, component: tuple[str, str, str]) -> None:
        self.component = component
        super().__init__(
            f"Unsupported Settlement type: {component!r}. Add a reviewed registry entry."
        )


def classify_settlement_row(
    row: Mapping[str, str],
) -> tuple[AllocationCategory, str | None, str, str | None]:
    key = (
        row["transaction-type"].strip(),
        row["amount-type"].strip(),
        row["amount-description"].strip(),
    )
    definition = SETTLEMENT_TYPE_BY_SOURCE.get(key)
    if definition is None:
        raise UnknownSettlementTypeError(key)
    category, family = definition.category, definition.family
    if family == "F1" and not row["marketplace-name"].strip():
        raise ValueError("F1 requires an explicit marketplace-name on every row.")
    if category is AllocationCategory.SETTLEMENT and not row["sku"].strip():
        raise ValueError(f"{family} requires a nonblank SKU, including on zero amounts.")
    if category is AllocationCategory.SELBOX and family is not None and row["sku"].strip():
        raise ValueError(f"{family} requires a blank SKU.")
    return category, family, definition.component_type, definition.accounting_subtype
