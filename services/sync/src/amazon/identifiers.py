"""Validation for stable Amazon identifiers."""

import re

_MARKETPLACE_ID_PATTERN = re.compile(r"^[A-Z0-9]{8,32}$")


def validate_marketplace_id(value: str) -> str:
    """Return one canonical Amazon marketplace ID."""
    marketplace_id = value.strip()
    if marketplace_id != value or not _MARKETPLACE_ID_PATTERN.fullmatch(marketplace_id):
        raise ValueError(f"Invalid stable Amazon marketplace_id: {value!r}.")
    return marketplace_id


__all__ = ["validate_marketplace_id"]
