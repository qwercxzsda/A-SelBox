"""Explicit allocation families with a nonblocking SelBox-retained remainder."""

import re
from collections.abc import Mapping

from ..allocation import AllocationCategory
from .cost_families import match_cost_family
from .retrocharges import RETROCHARGE_COMPONENTS

_ACCOUNT_LABELS = {
    "Subscription Fee": "OPERATING_EXPENSE",
    "Current Reserve Amount": "BALANCE_MOVEMENT",
    "Previous Reserve Amount Balance": "BALANCE_MOVEMENT",
    "Payable to Amazon": "BALANCE_MOVEMENT",
    "Successful charge": "BALANCE_MOVEMENT",
}
_FAILED_TRANSFER_PREFIX = "Transfer of funds unsuccessful:"
_DEBT = re.compile(r"Cross-Account Debt Adjustment (against|for) [A-Z]{2}(?:, [A-Z]{2})*")


def classify_settlement_row(
    row: Mapping[str, str],
) -> tuple[AllocationCategory, str | None, str, str | None]:
    """Match first, then enforce invariants so broken known families cannot escape."""
    transaction = row["transaction-type"].strip()
    amount_type = row["amount-type"].strip()
    description = row["amount-description"].strip()
    family: str | None = None
    category = AllocationCategory.SELBOX
    subtype: str | None = None
    valid = True
    if transaction in {"Order", "Refund"}:
        family, category = "F1", AllocationCategory.SETTLEMENT
        valid = amount_type in {"ItemPrice", "ItemFees", "ItemWithheldTax", "Promotion"}
        if not row["marketplace-name"].strip():
            raise ValueError("F1 requires an explicit marketplace-name on every row.")
    elif transaction in {"Liquidations", "Liquidations Adjustments"}:
        family, category = "F2", AllocationCategory.SETTLEMENT
        valid = amount_type in {"ItemPrice", "ItemFees"}
    elif transaction == "other-transaction" and amount_type == "FBA Inventory Reimbursement":
        family, category = "F3", AllocationCategory.SETTLEMENT
    elif transaction == "AmazonFees" and amount_type in {
        "FBA fulfilment fee per unit - Correction",
        "FBA fulfilment fee per unit - Reversal",
    }:
        family, category = "F4", AllocationCategory.SETTLEMENT
        valid = description == "Base fee"
    elif transaction == "Debt Adjustment":
        family, category, subtype = "F5", AllocationCategory.SELBOX, "BALANCE_MOVEMENT"
        valid = amount_type == "Debt Adjustment" and _DEBT.fullmatch(description) is not None
    elif (
        transaction == "other-transaction"
        and amount_type == "other-transaction"
        and (description in _ACCOUNT_LABELS or description.startswith(_FAILED_TRANSFER_PREFIX))
    ):
        family, category = "F6", AllocationCategory.SELBOX
        subtype = _ACCOUNT_LABELS.get(description, "BALANCE_MOVEMENT")
        if description.startswith(_FAILED_TRANSFER_PREFIX):
            valid = bool(description[len(_FAILED_TRANSFER_PREFIX) :].strip())
    elif transaction in {"Order_Retrocharge", "Refund_Retrocharge"}:
        family, category, subtype = "F7", AllocationCategory.SELBOX, "TAX_RECLASSIFICATION"
        valid = (amount_type, description) in RETROCHARGE_COMPONENTS
    elif cost_family := match_cost_family(transaction, amount_type, description):
        family, category = f"C3_{cost_family}", AllocationCategory.DATA_KIOSK
    if family and (not valid or not description):
        raise ValueError(f"{family} contains an unsupported or incomplete component.")
    if category is AllocationCategory.SETTLEMENT and not row["sku"].strip():
        raise ValueError(f"{family} requires a nonblank SKU, including on zero amounts.")
    if category is AllocationCategory.SELBOX and family is not None and row["sku"].strip():
        raise ValueError(f"{family} requires a blank SKU.")
    component_type = f"{transaction}/{amount_type}/{description}"
    if family == "F1" and amount_type == "ItemPrice" and description == "Principal":
        component_type = "PRODUCT_SALES" if transaction == "Order" else "PRODUCT_REFUNDS"
    return category, family, component_type, subtype
