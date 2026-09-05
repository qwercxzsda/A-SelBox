"""Deterministic value helpers shared by allocation grouping stages."""

from collections.abc import Sequence


def single_distinct_value(values: Sequence[str | None]) -> str | None:
    """Return the sole non-null value, or null when zero/multiple values exist."""
    distinct = {value for value in values if value is not None}
    return next(iter(distinct)) if len(distinct) == 1 else None


def sortable_group_key(values: Sequence[object]) -> tuple[str, ...]:
    """Convert nullable heterogeneous keys to a deterministic sortable form."""
    return tuple("" if value is None else str(value) for value in values)


__all__ = ["single_distinct_value", "sortable_group_key"]
