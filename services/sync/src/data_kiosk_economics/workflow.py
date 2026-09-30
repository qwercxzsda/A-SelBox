"""Publish complete Data Kiosk source days from retained acquisitions."""

import logging

from ..amazon.marketplace_names import marketplace_name_from_id
from ..archives.storage import ArchiveStorage
from ..database.acquisitions import load_data_kiosk_acquisition
from ..database.connection import DatabaseConnection
from ..database.source_versions import current_data_kiosk_versions, publish_data_kiosk
from .preprocess import prepare_data_kiosk_acquisition

_LOG = logging.getLogger(__name__)


def preprocess_data_kiosk_acquisition(
    database: DatabaseConnection,
    storage: ArchiveStorage,
    acquisition_id: str,
) -> str:
    """Publish the batch and every complete day together; never fetch missing inputs."""
    try:
        acquisition = load_data_kiosk_acquisition(database, acquisition_id)
        expected = current_data_kiosk_versions(
            database,
            acquisition,
            marketplace_name_from_id(acquisition.marketplace_id),
        )
        days = prepare_data_kiosk_acquisition(acquisition, storage)
        batch_id = publish_data_kiosk(database, acquisition, days, expected)
    except Exception:
        _LOG.exception(
            "Offline Data Kiosk preprocessing failed; acquisition_id=%s remains retained.",
            acquisition_id,
        )
        raise
    _LOG.info("Published Data Kiosk batch %s with %d complete days.", batch_id, len(days))
    return batch_id
