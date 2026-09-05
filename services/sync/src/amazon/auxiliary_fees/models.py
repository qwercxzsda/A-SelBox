"""Source-neutral fee observations used by Amazon allocation adapters."""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum

from ...canonical_values import validate_sha256
from ...frozen_values import freeze_mapping
from ...numeric import Numeric

_CATEGORY_CODE_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{1,79}$")
_CURRENCY_PATTERN = re.compile(r"^[A-Z]{3}$")
_REMOVAL_CATEGORIES = frozenset({"DISPOSAL_FEES", "REMOVAL_FEES"})


class AuxiliaryFeeSource(StrEnum):
    """Amazon systems that can provide fee attribution evidence."""

    DATA_KIOSK = "DATA_KIOSK"
    FBA_REPORT = "FBA_REPORT"


@dataclass(frozen=True)
class AuxiliaryFeeObservation:
    """One signed fee amount at a source's native SKU/date grain."""

    source_system: AuxiliaryFeeSource
    observed_start_date: date
    observed_end_date: date
    marketplace_id: str
    category_code: str
    amz_sku: str
    currency: str
    reported_amount: Numeric
    normalized_amount: Numeric
    source_reference_hash: str
    source_grain: Mapping[str, object]
    taxonomy: Mapping[str, object]
    removal_order_id: str | None = field(default=None, repr=False)
    quantity: Numeric | None = None

    def __post_init__(self) -> None:
        """Reject incomplete or non-finite evidence before processing."""
        if self.observed_start_date > self.observed_end_date:
            raise ValueError("observed_start_date must not be after observed_end_date.")
        _require_nonempty("marketplace_id", self.marketplace_id)
        _require_nonempty("amz_sku", self.amz_sku)
        if not _CATEGORY_CODE_PATTERN.fullmatch(self.category_code):
            raise ValueError("category_code must be an uppercase database category code.")
        if not _CURRENCY_PATTERN.fullmatch(self.currency):
            raise ValueError("currency must be a three-letter uppercase ISO 4217 code.")
        _validate_removal_order(
            self.source_system,
            self.category_code,
            self.removal_order_id,
        )
        _validate_amounts(self.reported_amount, self.normalized_amount)
        validate_sha256(self.source_reference_hash, "source_reference_hash")
        object.__setattr__(
            self,
            "source_grain",
            freeze_mapping(self.source_grain, field_name="source_grain"),
        )
        object.__setattr__(
            self,
            "taxonomy",
            freeze_mapping(self.taxonomy, field_name="taxonomy"),
        )


def _require_nonempty(field_name: str, value: str) -> None:
    if not value.strip():
        raise ValueError(f"{field_name} must not be empty.")


def _validate_removal_order(
    source_system: AuxiliaryFeeSource,
    category_code: str,
    removal_order_id: str | None,
) -> None:
    if category_code in _REMOVAL_CATEGORIES:
        if source_system is not AuxiliaryFeeSource.FBA_REPORT or removal_order_id is None:
            raise ValueError("FBA removal observations require removal_order_id.")
        _require_nonempty("removal_order_id", removal_order_id)
    elif removal_order_id is not None:
        raise ValueError("removal_order_id is valid only for FBA removal observations.")


def _validate_amounts(reported_amount: Numeric, normalized_amount: Numeric) -> None:
    if normalized_amount != -reported_amount:
        raise ValueError("normalized_amount must negate reported_amount.")


__all__ = [
    "AuxiliaryFeeObservation",
    "AuxiliaryFeeSource",
]
