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
from ..numeric import Numeric
from ..source_serialization import content_sha256
from .acquisition_coverage import validate_acquisition_coverage
from .components import build_components
from .coverage import validate_requested_fields
from .models import DataKioskDay, DataKioskTransaction, validate_component_keys
from .timestamps import reporting_activity_at


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
    activity_at = reporting_activity_at(day, marketplace_name)
    validate_component_keys(components)
    components = tuple(
        row
        for row in components
        if row.amount != 0 or row.quantity not in (None, 0) or row.fee_base not in (None, 0)
    )
    digest = content_sha256(
        {
            "marketplace_name": marketplace_name,
            "activity_date": day,
            "activity_at": activity_at,
            "dataset_key": "economics",
            "complete": True,
            "components": [
                {
                    "component_key": row.component_key,
                    "sku": row.sku,
                    "category": row.category,
                    "component_type": row.component_type,
                    "currency": row.currency,
                    "amount": _canonical_number(row.amount),
                    "quantity": _canonical_number(row.quantity),
                    "fee_base": _canonical_number(row.fee_base),
                }
                for row in sorted(components, key=lambda row: row.component_key)
            ],
        }
    )
    return DataKioskDay(marketplace_name, day, activity_at, digest, components)


def _canonical_number(value: Numeric | None) -> str | None:
    """Reuse equal decimal values regardless of their source formatting."""
    if value is None:
        return None
    if value == 0:
        return "0"
    result = format(value.value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result
