"""Prove that a saved acquisition covers the complete selected daily dataset."""

from ..amazon.data_kiosk.models import DataKioskDocumentKind
from ..amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
    canonicalize_graphql_query,
)
from ..amazon.data_kiosk.responses import extract_pagination_token
from ..amazon.datetimes import parse_amazon_datetime
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
    for page in acquisition.pages:
        metadata = page.api_metadata
        source_query = metadata.get("query")
        if not isinstance(source_query, str) or canonicalize_graphql_query(source_query) != query:
            raise ValueError(
                "Data Kiosk page query does not establish the complete requested scope."
            )
        created_time = metadata.get("createdTime")
        if (
            not isinstance(created_time, str)
            or parse_amazon_datetime(created_time) != page.query_created_at
        ):
            raise ValueError("Data Kiosk page source creation time differs from its manifest.")
        if bool(extract_pagination_token(metadata, "getQuery")) == page.is_terminal:
            raise ValueError("Data Kiosk pagination provenance does not prove complete traversal.")
        if metadata.get("errorDocumentId"):
            raise ValueError("A Data Kiosk error response cannot establish empty coverage.")
        source_document = metadata.get("dataDocumentId")
        if page.document_kind is DataKioskDocumentKind.DATA:
            if source_document != page.document_id:
                raise ValueError("Data Kiosk response document identity differs from its archive.")
        elif source_document or not page.is_terminal:
            raise ValueError(
                "Unverified NO_DATA response cannot establish complete empty activity."
            )
