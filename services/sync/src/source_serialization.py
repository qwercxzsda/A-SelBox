"""Exact JSON values and deterministic source-content comparisons."""

import json
from collections.abc import Mapping
from dataclasses import fields, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from hashlib import sha256
from typing import cast
from uuid import UUID

from .numeric import Numeric


def source_json(value: object) -> object:
    """Serialize monetary values as exact decimal strings, never binary floats."""
    if isinstance(value, Numeric | Decimal):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if is_dataclass(value) and not isinstance(value, type):
        return {item.name: source_json(getattr(value, item.name)) for item in fields(value)}
    if isinstance(value, Mapping):
        return {
            str(key): source_json(item)
            for key, item in cast(Mapping[object, object], value).items()
        }
    if isinstance(value, tuple | list):
        return [source_json(item) for item in cast(tuple[object, ...] | list[object], value)]
    return value


def source_mapping(value: object) -> dict[str, object]:
    result = source_json(value)
    if not isinstance(result, dict):
        raise TypeError("Source record must serialize to a JSON object.")
    return cast(dict[str, object], result)


def content_sha256(value: object) -> str:
    """Hash normalized contents independently of JSON mapping order."""
    encoded = json.dumps(
        source_json(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()
    return sha256(encoded).hexdigest()
