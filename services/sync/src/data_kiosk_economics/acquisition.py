"""In-memory acquisition and processing of Data Kiosk provision facts."""

from dataclasses import dataclass, field
from datetime import date

from ..amazon.data_kiosk.client_protocol import DataKioskClient
from ..amazon.data_kiosk.economics_acquisition import iter_economics_document_pages
from ..amazon.data_kiosk.economics_downloads import DownloadedEconomicsDocuments
from ..amazon.data_kiosk.economics_models import DailyMskuEconomicsFact
from ..amazon.data_kiosk.economics_processing import normalize_parsed_economics_documents
from ..amazon.data_kiosk.economics_source_parsing import parse_economics_source_documents
from ..amazon.data_kiosk.lifecycle import (
    DEFAULT_MAX_POLL_ATTEMPTS,
    DEFAULT_POLL_INTERVAL_SECONDS,
)
from ..amazon.data_kiosk.limits import DEFAULT_MAX_DATA_PAGES
from ..amazon.data_kiosk.query_builder import build_daily_msku_economics_query
from ..amazon.identifiers import validate_marketplace_id


@dataclass(frozen=True, slots=True)
class MarketplaceProvisionData:
    """Fully processed facts for one requested marketplace window."""

    marketplace_id: str
    query_start_date: date
    query_end_date: date
    facts: tuple[DailyMskuEconomicsFact, ...] = field(repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "marketplace_id",
            validate_marketplace_id(self.marketplace_id),
        )
        if self.query_start_date > self.query_end_date:
            raise ValueError("Provision query start date must not be after its end date.")
        for fact in self.facts:
            if fact.marketplace_id != self.marketplace_id:
                raise ValueError("A Data Kiosk fact belongs to an unexpected marketplace.")
            if fact.start_date != fact.end_date:
                raise ValueError("Data Kiosk provision facts must use DAY grain.")
            if not self.query_start_date <= fact.start_date <= self.query_end_date:
                raise ValueError("A Data Kiosk fact is outside the requested provision window.")


def download_and_process_data_kiosk_provision(
    client: DataKioskClient,
    *,
    marketplace_id: str,
    query_start_date: date,
    query_end_date: date,
    max_pages: int = DEFAULT_MAX_DATA_PAGES,
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
) -> MarketplaceProvisionData:
    """Download, structural-parse, and normalize one window without a DB write."""
    query = build_daily_msku_economics_query(
        query_start_date,
        query_end_date,
        marketplace_id,
    )
    downloaded = DownloadedEconomicsDocuments(
        pages=tuple(
            iter_economics_document_pages(
                client,
                query,
                max_pages=max_pages,
                max_poll_attempts=max_poll_attempts,
                poll_interval_seconds=poll_interval_seconds,
            )
        )
    )
    parsed = parse_economics_source_documents(downloaded)
    processed = normalize_parsed_economics_documents(parsed)
    return MarketplaceProvisionData(
        marketplace_id=marketplace_id,
        query_start_date=query_start_date,
        query_end_date=query_end_date,
        facts=processed.facts,
    )


__all__ = [
    "MarketplaceProvisionData",
    "download_and_process_data_kiosk_provision",
]
