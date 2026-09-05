"""Map Amazon Economics fee labels to verbose settlement categories."""

import re

FBA_AGED_INVENTORY_FEES = "FBA_AGED_INVENTORY_FEES"
FBA_INBOUND_PLACEMENT_FEES = "FBA_INBOUND_PLACEMENT_FEES"
FBA_STORAGE_FEES = "FBA_STORAGE_FEES"
INBOUND_TRANSPORTATION_FEES = "INBOUND_TRANSPORTATION_FEES"
ADVERTISING_COST = "ADVERTISING_COST"
SPONSORED_BRANDS_CHARGES = "SPONSORED_BRANDS_CHARGES"
SPONSORED_DISPLAY_CHARGES = "SPONSORED_DISPLAY_CHARGES"
SPONSORED_PRODUCTS_CHARGES = "SPONSORED_PRODUCTS_CHARGES"

_ACRONYM_BOUNDARY = re.compile(r"([A-Z]+)([A-Z][a-z])")
_WORD_BOUNDARY = re.compile(r"([a-z0-9])([A-Z])")
_NON_ALPHANUMERIC = re.compile(r"[^A-Za-z0-9]+")
_CONFIRMED_AUXILIARY_FEE_CATEGORIES = {
    "MONTHLY_INVENTORY_STORAGE_FEE": FBA_STORAGE_FEES,
    "FBA_AGED_INVENTORY_SURCHARGE": FBA_AGED_INVENTORY_FEES,
    "FBA_INBOUND_PLACEMENT_SERVICE_FEE": FBA_INBOUND_PLACEMENT_FEES,
    "FBA_INBOUND_TRANSPORTATION_FEE": INBOUND_TRANSPORTATION_FEES,
    "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE": INBOUND_TRANSPORTATION_FEES,
}


def canonicalize_economics_taxonomy(value: str) -> str:
    """Canonicalize Amazon's human-readable and camel-case taxonomy labels."""
    acronym_split = _ACRONYM_BOUNDARY.sub(r"\1_\2", value.strip())
    word_split = _WORD_BOUNDARY.sub(r"\1_\2", acronym_split)
    separated = _NON_ALPHANUMERIC.sub("_", word_split)
    return separated.strip("_").upper()


def classify_auxiliary_fee(fee_type_name: str) -> str | None:
    """Map only fee labels confirmed by the live marketplace probes."""
    return _CONFIRMED_AUXILIARY_FEE_CATEGORIES.get(canonicalize_economics_taxonomy(fee_type_name))


def classify_ad_charge(ad_type_name: str) -> str:
    """Map known sponsored-ad products while retaining a safe generic fallback."""
    canonical_name = canonicalize_economics_taxonomy(ad_type_name)
    if "SPONSORED_PRODUCT" in canonical_name:
        return SPONSORED_PRODUCTS_CHARGES
    if "SPONSORED_BRAND" in canonical_name or "HEADLINE_SEARCH" in canonical_name:
        return SPONSORED_BRANDS_CHARGES
    if "SPONSORED_DISPLAY" in canonical_name or "PRODUCT_DISPLAY" in canonical_name:
        return SPONSORED_DISPLAY_CHARGES
    return ADVERTISING_COST


__all__ = [
    "ADVERTISING_COST",
    "FBA_AGED_INVENTORY_FEES",
    "FBA_INBOUND_PLACEMENT_FEES",
    "FBA_STORAGE_FEES",
    "INBOUND_TRANSPORTATION_FEES",
    "SPONSORED_BRANDS_CHARGES",
    "SPONSORED_DISPLAY_CHARGES",
    "SPONSORED_PRODUCTS_CHARGES",
    "canonicalize_economics_taxonomy",
    "classify_ad_charge",
    "classify_auxiliary_fee",
]
