"""Derive the smallest transient Amazon source set needed by one report."""

from .auxiliary_policy import AGED_STORAGE_CATEGORY, REMOVAL_CATEGORIES
from .classification import classify_ledger_entries
from .models import AuxiliaryRequirements, LedgerEntry
from .policy import SETTLEMENT_CATEGORY_RULES


def derive_auxiliary_requirements(
    ledger_entries: tuple[LedgerEntry, ...],
) -> AuxiliaryRequirements:
    """Select auxiliary products from classified Settlement content."""
    classified = classify_ledger_entries(ledger_entries, SETTLEMENT_CATEGORY_RULES)
    return AuxiliaryRequirements(
        data_kiosk=any(entry.preferred_auxiliary_source == "DATA_KIOSK" for entry in classified),
        fba_aged_storage=any(entry.category_code == AGED_STORAGE_CATEGORY for entry in classified),
        fba_removal=any(entry.category_code in REMOVAL_CATEGORIES for entry in classified),
    )


__all__ = ["derive_auxiliary_requirements"]
