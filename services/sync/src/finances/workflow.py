"""Offline complete Finances publication from retained successful acquisitions."""

from ..archives.storage import ArchiveStorage
from ..database.acquisitions import load_finances_acquisition
from ..database.connection import DatabaseConnection
from ..database.finances import current_finances_versions, publish_finances
from .preprocess import prepare_finances_acquisition


def preprocess_finances_acquisition(
    database: DatabaseConnection, storage: ArchiveStorage, acquisition_id: str
) -> str:
    acquisition = load_finances_acquisition(database, acquisition_id)
    expected = current_finances_versions(database, acquisition)
    prepared = prepare_finances_acquisition(acquisition, storage)
    return publish_finances(database, acquisition, prepared, expected)
