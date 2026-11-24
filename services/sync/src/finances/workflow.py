"""Offline validated Finance publication from archived acquisitions."""

import logging
from collections.abc import Mapping

from ..archives.storage import ArchiveStorage
from ..database.connection import DatabaseConnection
from ..database.finances import publish_finances
from ..reference.currencies import load_currency_decimals
from .acquisition_models import FinancesAcquisition
from .preprocess import prepare_finances_acquisition

_LOG = logging.getLogger(__name__)


def preprocess_finances_acquisition(
    database: DatabaseConnection,
    storage: ArchiveStorage,
    acquisition: FinancesAcquisition,
    currency_decimals: Mapping[str, int] | None = None,
) -> str:
    try:
        prepared = prepare_finances_acquisition(
            acquisition,
            storage,
            load_currency_decimals(database) if currency_decimals is None else currency_decimals,
        )
        return publish_finances(database, acquisition, prepared)
    except Exception as error:
        _LOG.error(
            "Finances preprocessing failed [acquisition_id=%s, exception_type=%s].",
            acquisition.id,
            type(error).__name__,
        )
        raise
