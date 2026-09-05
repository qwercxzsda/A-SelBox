"""Aggregate quantities belonging to one monetary metric and source population."""

from collections.abc import Iterable, Sequence

from ..numeric import ZERO, Numeric
from .models import LedgerEntry


def sum_known_quantities(values: Iterable[Numeric | int | None]) -> Numeric | None:
    """Keep an absent or partially unknown population unknown, including zero amounts."""
    total = ZERO
    has_quantity = False
    for value in values:
        if value is None:
            return None
        total += value if isinstance(value, Numeric) else Numeric(value)
        has_quantity = True
    return total if has_quantity else None


def settlement_metric_quantity(entries: Sequence[LedgerEntry]) -> Numeric | None:
    """Do not sum repeated unit counts from different charge components."""
    metrics = {
        (entry.transaction_type, entry.amount_type, entry.amount_description) for entry in entries
    }
    if len(metrics) != 1:
        return None
    return sum_known_quantities(entry.quantity for entry in entries)
