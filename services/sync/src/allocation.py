"""Named allocation categories shared by archived source components."""

from enum import StrEnum


class AllocationCategory(StrEnum):
    SETTLEMENT = "SETTLEMENT"
    SELBOX = "SELBOX"
    DATA_KIOSK = "DATA_KIOSK"
    ANALYSIS_ONLY = "ANALYSIS_ONLY"
