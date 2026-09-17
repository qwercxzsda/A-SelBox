"""Canonical economic contents for comparing independent source observations."""

import json
from collections.abc import Iterable, Mapping
from typing import cast

from ..source_serialization import source_mapping
from .models import DataKioskTransaction


def comparable_components(rows: Iterable[DataKioskTransaction]) -> list[dict[str, object]]:
    """Exclude provenance and physical row/array order without dropping detail."""
    components: list[dict[str, object]] = []
    for row in rows:
        content = source_mapping(row)
        content.pop("source_document_id")
        content.pop("source_line_number")
        components.append(cast(dict[str, object], _ordered_content(content)))
    return sorted(components, key=lambda component: str(component["component_key"]))


def _ordered_content(value: object) -> object:
    if isinstance(value, Mapping):
        return {
            key: _ordered_content(item) for key, item in cast(Mapping[str, object], value).items()
        }
    if isinstance(value, tuple | list):
        items = [_ordered_content(item) for item in cast(tuple[object, ...] | list[object], value)]
        return sorted(items, key=lambda item: json.dumps(item, sort_keys=True))
    return value
