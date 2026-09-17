"""Shared strict parsing for direct record arrays returned by SP-API clients."""

from collections.abc import Mapping
from typing import cast


def direct_payload_records(
    response: object,
    key: str,
    *,
    operation: str,
) -> tuple[Mapping[str, object], ...]:
    """Return one required direct record array from an SDK response."""
    payload: object = getattr(response, "payload", None)
    if not isinstance(payload, Mapping):
        raise ValueError(f"{operation} returned a non-object payload.")

    raw_records: object = cast(Mapping[str, object], payload).get(key)
    if not isinstance(raw_records, list):
        raise ValueError(f"{operation} response is missing its {key} array.")
    records = cast(list[object], raw_records)
    if any(not isinstance(record, Mapping) for record in records):
        raise ValueError(f"{operation} returned an invalid {key} entry.")
    return tuple(cast(Mapping[str, object], record) for record in records)


__all__ = ["direct_payload_records"]
