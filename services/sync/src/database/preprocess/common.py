from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

PreprocessType = Literal["order", "no_sku"]
type ResultRow = Sequence[str | int]

UNKNOWN_SKU: str = "__UNKNOWN__"
ALL_MARKETPLACES: str = "__ALL__"


@dataclass(frozen=True)
class PreprocessResult:
    settlement_id: str
    preprocess_run_id: str
    preprocess_type: PreprocessType
    inserted_count: int
    marked_not_current_count: int
    mapping_count: int = 0


def require_result_row(
    row: ResultRow | None,
    preprocess_type: PreprocessType,
    step: str,
) -> ResultRow:
    """Return one SQL result row or fail with workflow context."""
    if row is None:
        raise RuntimeError(f"{preprocess_type} preprocessing {step} returned no result row.")
    return row
