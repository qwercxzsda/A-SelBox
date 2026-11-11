"""Local successful download descriptors, including captures not yet accepted by the DB."""

import json
import os
import tempfile
from pathlib import Path
from typing import cast

from .acquisition_models import FinancesAcquisition
from .acquisition_serialization import (
    finances_acquisition_from_payload,
    finances_acquisition_payload,
)


def write_finances_manifest(path: Path, acquisition: FinancesAcquisition) -> None:
    """Create one complete capture manifest atomically, without replacing another capture."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = finances_acquisition_payload(acquisition)
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
        os.link(temporary, path)
    finally:
        if temporary is not None and Path(temporary).exists():
            Path(temporary).unlink()


def read_finances_manifest(path: Path) -> FinancesAcquisition:
    with path.open(encoding="utf-8") as stream:
        decoded: object = json.load(stream)
    if not isinstance(decoded, dict):
        raise ValueError("Finances local manifest must be an object.")
    return finances_acquisition_from_payload(cast(dict[str, object], decoded))
