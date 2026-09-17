"""Offline settlement preprocessing from retained successful acquisitions."""

import logging

from ..archives.storage import ArchiveStorage, load_document_archive
from ..database.acquisitions import load_settlement_acquisition
from ..database.connection import DatabaseConnection
from ..database.source_versions import publish_settlement, settlement_current_versions
from .raw_report import prepare_settlement_report

_LOG = logging.getLogger(__name__)


def preprocess_settlement_report(
    database: DatabaseConnection,
    storage: ArchiveStorage,
    acquisition_id: str,
    *,
    retrocharge_coverage: tuple[tuple[int, ...], ...] = (),
) -> str:
    """Publish one complete source version using only the saved manifest/archive."""
    try:
        acquisition = load_settlement_acquisition(database, acquisition_id)
        expected = settlement_current_versions(database, acquisition)
        document = load_document_archive(storage, acquisition.document)
        prepared = prepare_settlement_report(document, retrocharge_coverage=retrocharge_coverage)
        if prepared.document_sha256 != acquisition.document.document_sha256:
            raise ValueError("Parsed settlement digest differs from its acquisition.")
        version_id = publish_settlement(
            database,
            acquisition,
            prepared,
            expected.get(prepared.header.settlement_id),
        )
    except Exception:
        _LOG.exception(
            "Offline settlement preprocessing failed; acquisition_id=%s remains retained.",
            acquisition_id,
        )
        raise
    _LOG.info(
        "Published settlement source version %s with %d rows and %d diagnostics.",
        version_id,
        len(prepared.transactions),
        len(prepared.diagnostics),
    )
    return version_id
