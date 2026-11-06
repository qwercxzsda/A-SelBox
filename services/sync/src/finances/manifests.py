"""Local successful download descriptors, including captures not yet accepted by the DB."""

import json
import os
import tempfile
from collections.abc import Sequence
from pathlib import Path
from typing import cast

from .acquisition_models import FinancesAcquisition
from .acquisition_serialization import (
    finances_acquisition_from_payload,
    finances_acquisition_payload,
)


def write_finances_manifest(path: Path, acquisitions: Sequence[FinancesAcquisition]) -> None:
    """Replace a complete manifest atomically; private source metadata stays local."""
    if not acquisitions:
        raise ValueError("A Finances manifest requires at least one complete acquisition.")
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format_version": 1,
        "acquisitions": [finances_acquisition_payload(a) for a in acquisitions],
    }
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False
        ) as stream:
            temporary = stream.name
            json.dump(payload, stream, ensure_ascii=False, allow_nan=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        Path(temporary).replace(path)
    finally:
        if temporary is not None and Path(temporary).exists():
            Path(temporary).unlink()


def read_finances_manifest(path: Path) -> tuple[FinancesAcquisition, ...]:
    with path.open(encoding="utf-8") as stream:
        decoded: object = json.load(stream)
    if not isinstance(decoded, dict):
        raise ValueError("Finances local manifest must be an object.")
    payload = cast(dict[str, object], decoded)
    if payload.get("format_version") != 1:
        raise ValueError("Unsupported Finances local manifest format.")
    values = payload.get("acquisitions")
    if not isinstance(values, list) or not values:
        raise ValueError("Finances local manifest requires complete acquisition objects.")
    entries = cast(list[object], values)
    if any(not isinstance(entry, dict) for entry in entries):
        raise ValueError("Finances local manifest requires complete acquisition objects.")
    result = tuple(
        finances_acquisition_from_payload(cast(dict[str, object], entry)) for entry in entries
    )
    if len({acquisition.id for acquisition in result}) != len(result):
        raise ValueError("Finances local manifest repeats an acquisition identity.")
    return result
