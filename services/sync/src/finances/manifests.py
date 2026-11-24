"""Local successful download descriptors, including captures not yet accepted by the DB."""

import json
from pathlib import Path
from typing import cast

from ..archives.manifests import write_manifest
from .acquisition_models import FinancesAcquisition
from .acquisition_serialization import (
    finances_acquisition_from_payload,
    finances_acquisition_payload,
)


def write_finances_manifest(path: Path, acquisition: FinancesAcquisition) -> None:
    write_manifest(path, finances_acquisition_payload(acquisition))


def read_finances_manifest(path: Path) -> FinancesAcquisition:
    with path.open(encoding="utf-8") as stream:
        decoded: object = json.load(stream)
    if not isinstance(decoded, dict):
        raise ValueError("Finances local manifest must be an object.")
    return finances_acquisition_from_payload(cast(dict[str, object], decoded))
