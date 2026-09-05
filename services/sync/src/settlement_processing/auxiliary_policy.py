"""Explicit category policy for transient auxiliary fee evidence.

Settlement categories remain authoritative.  The policy only says which more
verbose auxiliary categories may explain a Settlement category; it never
changes the Settlement total.
"""

_ADVERTISING_OBSERVATION_CATEGORIES = frozenset(
    {
        "ADVERTISING_COST",
        "SPONSORED_PRODUCTS_CHARGES",
        "SPONSORED_BRANDS_CHARGES",
        "SPONSORED_DISPLAY_CHARGES",
    }
)
AGED_STORAGE_CATEGORY = "FBA_AGED_INVENTORY_FEES"
REMOVAL_CATEGORIES = frozenset({"REMOVAL_FEES", "DISPOSAL_FEES"})


def compatible_observation_categories(settlement_category_code: str) -> frozenset[str]:
    """Return auxiliary categories allowed to elaborate one Settlement category."""
    if settlement_category_code == "ADVERTISING_COST":
        return _ADVERTISING_OBSERVATION_CATEGORIES
    return frozenset({settlement_category_code})


__all__ = [
    "AGED_STORAGE_CATEGORY",
    "REMOVAL_CATEGORIES",
    "compatible_observation_categories",
]
