"""Detached, recursively immutable copies of nested domain mappings."""

from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import cast


def freeze_mapping(
    value: Mapping[str, object],
    *,
    field_name: str,
) -> Mapping[str, object]:
    """Copy a string-keyed mapping and freeze nested mappings and sequences."""
    return _freeze_nested_mapping(
        cast(Mapping[object, object], value),
        field_name=field_name,
    )


def _freeze_value(
    value: object,
    *,
    field_name: str,
) -> object:
    if isinstance(value, Mapping):
        return _freeze_nested_mapping(
            cast(Mapping[object, object], value),
            field_name=field_name,
        )
    if isinstance(value, set | bytearray | memoryview):
        raise ValueError(f"{field_name} contains an unsupported mutable container.")
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return tuple(
            _freeze_value(item, field_name=field_name) for item in cast(Sequence[object], value)
        )
    return value


def _freeze_nested_mapping(
    value: Mapping[object, object],
    *,
    field_name: str,
) -> Mapping[str, object]:
    frozen: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key:
            raise ValueError(f"{field_name} must contain only nonempty string keys.")
        frozen[key] = _freeze_value(item, field_name=field_name)
    return MappingProxyType(frozen)


__all__ = ["freeze_mapping"]
