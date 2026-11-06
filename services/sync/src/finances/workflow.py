"""Offline validated Finance publication from local download manifests."""

import logging
from pathlib import Path

from ..archives.storage import ArchiveStorage
from ..database.connection import DatabaseConnection
from ..database.finances import publish_finances
from .acquisition_models import FinancesAcquisition
from .manifests import read_finances_manifest
from .preprocess import prepare_finances_acquisition

_LOG = logging.getLogger(__name__)


def preprocess_finances_acquisition(
    database: DatabaseConnection, storage: ArchiveStorage, acquisition: FinancesAcquisition
) -> str:
    try:
        prepared = prepare_finances_acquisition(acquisition, storage)
        return publish_finances(database, acquisition, prepared)
    except Exception as error:
        _LOG.error(
            "Finances preprocessing failed [acquisition_id=%s, exception_type=%s].",
            acquisition.id,
            type(error).__name__,
        )
        raise


def preprocess_finances_manifest(
    database: DatabaseConnection, storage: ArchiveStorage, manifest_path: Path
) -> tuple[str, ...]:
    runs: list[str] = []
    for acquisition in read_finances_manifest(manifest_path):
        batch_id = preprocess_finances_acquisition(database, storage, acquisition)
        runs.append(batch_id)
        _LOG.info("Finances preprocessing complete [batch_id=%s].", batch_id)
    return tuple(runs)
