"""Offline complete-day preprocessing of an archived Data Kiosk acquisition."""

from collections import defaultdict
from datetime import date, timedelta

from ..amazon.data_kiosk.economics_downloads import (
    DownloadedEconomicsDocuments,
    DownloadedEconomicsPage,
)
from ..amazon.data_kiosk.economics_fact_normalization import (
    validate_daily_msku_economics_fact_scope,
)
from ..amazon.data_kiosk.economics_preprocess import normalize_parsed_economics_documents
from ..amazon.data_kiosk.economics_source_parsing import (
    ParsedEconomicsDocuments,
    parse_economics_source_documents,
)
from ..amazon.marketplace_names import marketplace_name_from_id
from ..archives.models import DataKioskAcquisition
from ..archives.storage import ArchiveStorage, load_document_archive
from ..preprocess_version import PREPROCESS_VERSION
from ..source_serialization import content_sha256
from .acquisition_coverage import validate_acquisition_coverage
from .comparison import comparable_components
from .components import build_components
from .coverage import validate_requested_fields
from .models import DataKioskDay, DataKioskTransaction


def prepare_data_kiosk_acquisition(
    acquisition: DataKioskAcquisition,
    storage: ArchiveStorage,
) -> tuple[DataKioskDay, ...]:
    """Validate complete scope before interpreting missing rows as covered empty days."""
    validate_acquisition_coverage(acquisition)
    marketplace_name = marketplace_name_from_id(acquisition.marketplace_id)
    parsed = _load_verified_documents(acquisition, storage)
    facts = normalize_parsed_economics_documents(parsed)
    validate_daily_msku_economics_fact_scope(
        facts,
        marketplace_id=acquisition.marketplace_id,
        start_date=acquisition.query_start_date,
        end_date=acquisition.query_end_date,
    )
    grouped: defaultdict[date, list[DataKioskTransaction]] = defaultdict(list)
    for fact in facts:
        grouped[fact.start_date].extend(build_components(fact))
    days: list[DataKioskDay] = []
    day = acquisition.query_start_date
    while day <= acquisition.query_end_date:
        days.append(_complete_day(marketplace_name, day, tuple(grouped[day])))
        day += timedelta(days=1)
    return tuple(days)


def _load_verified_documents(
    acquisition: DataKioskAcquisition,
    storage: ArchiveStorage,
) -> ParsedEconomicsDocuments:
    documents = DownloadedEconomicsDocuments(
        pages=tuple(
            DownloadedEconomicsPage(
                page_number=page.page_number,
                query_id=page.query_id,
                document_kind=page.document_kind,
                is_terminal=page.is_terminal,
                document_id=page.document_id,
                document=load_document_archive(storage, page.document)
                if page.document is not None
                else None,
            )
            for page in acquisition.pages
        )
    )
    parsed = parse_economics_source_documents(documents)
    for source, normalized in zip(acquisition.pages, parsed.pages, strict=True):
        if (
            source.document is not None
            and normalized.parsed_document is not None
            and (source.document.document_sha256 != normalized.parsed_document.decoded_sha256)
        ):
            raise ValueError("Parsed Data Kiosk bytes differ from the archived document digest.")
    validate_requested_fields(parsed)
    return parsed


def _complete_day(
    marketplace_name: str,
    day: date,
    components: tuple[DataKioskTransaction, ...],
) -> DataKioskDay:
    keys = [row.component_key for row in components]
    if len(keys) != len(set(keys)):
        raise ValueError("Data Kiosk day contains duplicate economic component identities.")
    digest = content_sha256(
        {
            "marketplace_name": marketplace_name,
            "activity_date": day,
            "dataset_key": "economics",
            "preprocess_version": PREPROCESS_VERSION,
            "complete": True,
            "components": comparable_components(components),
        }
    )
    return DataKioskDay(marketplace_name, day, digest, components)
