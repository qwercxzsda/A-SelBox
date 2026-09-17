"""Allocation failures retained as Python diagnostics, never financial facts."""

from typing import Literal


class UnresolvedDataKioskComponentError(ValueError):
    """Identify an unallocatable source component without logging private values."""

    def __init__(
        self,
        reason: Literal[
            "UNKNOWN_FEE", "UNKNOWN_AD", "MISSING_FEE_CHARGES", "MISSING_AD_CHARGE", "MISSING_ADS"
        ],
        *,
        collection: Literal["fees", "ads"],
        label: str | None = None,
        source_line_number: int | None = None,
    ) -> None:
        self.diagnostic_code = f"DATA_KIOSK_{reason}"
        self.reason = reason
        self.collection = collection
        self.label = label
        self.source_line_number = source_line_number
        location = "" if source_line_number is None else f" at source line {source_line_number}"
        super().__init__(f"Data Kiosk {collection} allocation failed ({reason}){location}.")
