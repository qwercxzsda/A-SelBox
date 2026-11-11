"""Prove that a saved acquisition covers the complete selected daily dataset."""

from ..amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
    canonicalize_graphql_query,
)
from ..amazon.marketplaces import get_marketplace_timezone
from ..archives.models import DataKioskAcquisition


def validate_acquisition_coverage(acquisition: DataKioskAcquisition) -> None:
    """Pinned full query and successful complete page provenance establish coverage."""
    if acquisition.schema_version != ECONOMICS_SCHEMA_NAME:
        raise ValueError("Unsupported Data Kiosk schema; complete coverage cannot be established.")
    observation_day = acquisition.root_query_created_at.astimezone(
        get_marketplace_timezone(acquisition.marketplace_id)
    ).date()
    if acquisition.query_end_date >= observation_day:
        raise ValueError("Data Kiosk source observation cannot cover an unfinished local day.")
    query = canonicalize_graphql_query(
        build_daily_msku_economics_query(
            acquisition.query_start_date,
            acquisition.query_end_date,
            acquisition.marketplace_id,
        )
    )
    if canonicalize_graphql_query(acquisition.query_definition) != query:
        raise ValueError(
            "Data Kiosk acquisition must cover the complete unfiltered DAY/MSKU dataset."
        )
