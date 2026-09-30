"""Offline inventory capture preprocessing using retained, verified archive bytes."""

import logging

from ..archives.storage import ArchiveStorage, load_document_archive
from ..database.acquisitions import load_inventory_acquisition
from ..database.connection import DatabaseConnection
from ..database.inventory import (
    current_inventory_capture,
    publish_inventory_capture,
)
from .parser import prepare_inventory_report

_LOG = logging.getLogger(__name__)


def preprocess_inventory_acquisition(
    database: DatabaseConnection, storage: ArchiveStorage, acquisition_id: str
) -> str:
    """Replace one original report day; this workflow never imports Amazon clients."""
    acquisition = load_inventory_acquisition(database, acquisition_id)
    expected = current_inventory_capture(database, acquisition)
    content = load_document_archive(storage, acquisition.document)
    prepared = prepare_inventory_report(content, marketplace_id=acquisition.marketplace_id)
    capture_id = publish_inventory_capture(database, acquisition, prepared, expected)
    _LOG.info(
        "Inventory preprocessing complete [capture_id=%s, rows=%d, diagnostics=%d].",
        capture_id,
        len(prepared.items),
        len(prepared.diagnostics),
    )
    return capture_id
