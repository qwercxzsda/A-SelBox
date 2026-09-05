"""Validation for SHA-256 values retained by transient source models."""

import re

_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def validate_sha256(value: object, field_name: str) -> str:
    """Return one lowercase SHA-256 digest."""
    if not isinstance(value, str) or not _SHA256_PATTERN.fullmatch(value):
        raise ValueError(f"{field_name} must be a lowercase SHA-256 digest.")
    return value


__all__ = ["validate_sha256"]
