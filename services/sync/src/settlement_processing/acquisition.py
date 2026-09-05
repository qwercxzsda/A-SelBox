"""Fetch, log, parse, and process transient inputs for one Settlement report."""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from ..amazon.auxiliary_fees import AuxiliaryFeeBatch
from ..amazon.data_kiosk.client_protocol import DataKioskClient
from ..amazon.data_kiosk.economics_acquisition import iter_economics_document_pages
from ..amazon.data_kiosk.economics_batches import build_economics_fee_batch
from ..amazon.data_kiosk.economics_downloads import DownloadedEconomicsDocuments
from ..amazon.data_kiosk.economics_processing import normalize_parsed_economics_documents
from ..amazon.data_kiosk.economics_source_parsing import parse_economics_source_documents
from ..amazon.data_kiosk.query_builder import build_daily_msku_economics_query
from ..amazon.fba_reports.acquisition import (
    download_aged_storage_report,
    download_removal_report,
)
from ..amazon.fba_reports.lifecycle import FbaReportsClient
from ..amazon.fba_reports.parsing import (
    parse_aged_storage_fee_document,
    parse_removal_fee_document,
)
from ..amazon.fba_reports.processing import (
    build_aged_storage_fee_batch_from_parsed,
    build_removal_fee_batch_from_parsed,
)
from ..amazon.fba_reports.requests import closed_calendar_month_aged_storage_windows
from ..amazon.reports.decoding import decompress_report_document
from .artifacts import ProcessingArtifactLog
from .models import (
    AuxiliaryFeeObservation,
    AuxiliaryRequirements,
    PreparedSettlement,
)

DEFAULT_REMOVAL_ORDER_LOOKBACK_DAYS = 365
DEFAULT_MAX_POLL_ATTEMPTS = 120
DEFAULT_POLL_INTERVAL_SECONDS = 5.0


@dataclass(frozen=True, slots=True, kw_only=True)
class AuxiliaryAcquisitionSettings:
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS
    removal_order_lookback_days: int = DEFAULT_REMOVAL_ORDER_LOOKBACK_DAYS

    def __post_init__(self) -> None:
        if type(self.max_poll_attempts) is not int or self.max_poll_attempts < 1:
            raise ValueError("Maximum poll attempts must be positive.")
        if (
            type(self.poll_interval_seconds) not in (int, float)
            or not math.isfinite(self.poll_interval_seconds)
            or self.poll_interval_seconds < 0
        ):
            raise ValueError("Poll interval seconds must be finite and non-negative.")
        if (
            type(self.removal_order_lookback_days) is not int
            or self.removal_order_lookback_days < 1
        ):
            raise ValueError("Removal-order lookback days must be positive.")


@dataclass(frozen=True, slots=True)
class AuxiliaryClients:
    data_kiosk: DataKioskClient | None = None
    reports: FbaReportsClient | None = None


def acquire_auxiliary_observations(
    settlement: PreparedSettlement,
    requirements: AuxiliaryRequirements,
    clients: AuxiliaryClients,
    artifacts: ProcessingArtifactLog,
    settings: AuxiliaryAcquisitionSettings,
    *,
    now: datetime | None = None,
) -> tuple[AuxiliaryFeeObservation, ...]:
    """Return normalized evidence while storing no auxiliary row in Postgres."""
    fetched_at = _aware_now(now)
    batches: list[AuxiliaryFeeBatch] = []
    for marketplace_id in settlement.header.marketplace_ids:
        if requirements.data_kiosk:
            batches.append(
                _acquire_data_kiosk(
                    settlement,
                    marketplace_id,
                    clients,
                    artifacts,
                    settings,
                )
            )
        if requirements.fba_aged_storage:
            batches.extend(
                _acquire_aged_storage(
                    settlement,
                    marketplace_id,
                    clients,
                    artifacts,
                    settings,
                    fetched_at=fetched_at,
                )
            )
        if requirements.fba_removal:
            batches.append(
                _acquire_removal(
                    settlement,
                    marketplace_id,
                    clients,
                    artifacts,
                    settings,
                    fetched_at=fetched_at,
                )
            )
    observations = _planner_observations(batches)
    artifacts.write_json(
        Path("manifest.json"),
        {
            "processing_log_id": artifacts.directory.name,
            "settlement_report_id": settlement.report.id,
            "requirements": {
                "data_kiosk": requirements.data_kiosk,
                "fba_aged_storage": requirements.fba_aged_storage,
                "fba_removal": requirements.fba_removal,
            },
            "marketplace_ids": settlement.header.marketplace_ids,
            "batch_count": len(batches),
            "observation_count": len(observations),
            "fetched_at": fetched_at,
        },
    )
    return observations


def _acquire_data_kiosk(
    settlement: PreparedSettlement,
    marketplace_id: str,
    clients: AuxiliaryClients,
    artifacts: ProcessingArtifactLog,
    settings: AuxiliaryAcquisitionSettings,
) -> AuxiliaryFeeBatch:
    if clients.data_kiosk is None:
        raise RuntimeError("Settlement processing requires a Data Kiosk client.")
    header = settlement.header
    query = build_daily_msku_economics_query(
        header.settlement_start_date,
        header.settlement_end_date,
        marketplace_id,
    )
    downloaded = DownloadedEconomicsDocuments(
        pages=tuple(
            iter_economics_document_pages(
                clients.data_kiosk,
                query,
                max_poll_attempts=settings.max_poll_attempts,
                poll_interval_seconds=settings.poll_interval_seconds,
            )
        )
    )
    for page in downloaded.pages:
        if page.document is not None:
            artifacts.write_bytes(
                Path("data-kiosk", marketplace_id, f"page-{page.page_number}.jsonl"),
                page.document,
            )
    parsed = parse_economics_source_documents(downloaded)
    normalized = normalize_parsed_economics_documents(parsed)
    return build_economics_fee_batch(
        normalized,
        settlement_report_id=settlement.report.id,
        seller_namespace=header.seller_namespace,
        amazon_scope=header.amazon_scope,
        marketplace_id=marketplace_id,
        start_date=header.settlement_start_date,
        end_date=header.settlement_end_date,
    )


def _acquire_aged_storage(
    settlement: PreparedSettlement,
    marketplace_id: str,
    clients: AuxiliaryClients,
    artifacts: ProcessingArtifactLog,
    settings: AuxiliaryAcquisitionSettings,
    *,
    fetched_at: datetime,
) -> tuple[AuxiliaryFeeBatch, ...]:
    if clients.reports is None:
        raise RuntimeError("Settlement processing requires a Reports client.")
    header = settlement.header
    windows = closed_calendar_month_aged_storage_windows(
        header.settlement_start_at,
        header.settlement_end_at,
        available_at=fetched_at,
    )
    batches: list[AuxiliaryFeeBatch] = []
    for ordinal, window in enumerate(windows, start=1):
        downloaded = download_aged_storage_report(
            clients.reports,
            marketplace_id=marketplace_id,
            window=window,
            now=fetched_at,
            max_poll_attempts=settings.max_poll_attempts,
            poll_interval_seconds=settings.poll_interval_seconds,
        )
        decoded = decompress_report_document(downloaded.document)
        artifacts.write_bytes(
            Path("fba-long-term", marketplace_id, f"report-{ordinal}.tsv"),
            decoded,
        )
        parsed = parse_aged_storage_fee_document(
            decoded,
            amazon_scope=header.amazon_scope,
        )
        batches.append(
            build_aged_storage_fee_batch_from_parsed(
                downloaded.report_summary,
                parsed,
                settlement_report_id=settlement.report.id,
                seller_namespace=header.seller_namespace,
                amazon_scope=header.amazon_scope,
                marketplace_id=marketplace_id,
                window=window,
            )
        )
    return tuple(batches)


def _acquire_removal(
    settlement: PreparedSettlement,
    marketplace_id: str,
    clients: AuxiliaryClients,
    artifacts: ProcessingArtifactLog,
    settings: AuxiliaryAcquisitionSettings,
    *,
    fetched_at: datetime,
) -> AuxiliaryFeeBatch:
    if clients.reports is None:
        raise RuntimeError("Settlement processing requires a Reports client.")
    header = settlement.header
    data_start_at = header.settlement_start_at - timedelta(
        days=settings.removal_order_lookback_days
    )
    downloaded = download_removal_report(
        clients.reports,
        marketplace_id=marketplace_id,
        data_start_at=data_start_at,
        data_end_at=header.settlement_end_at,
        now=fetched_at,
        max_poll_attempts=settings.max_poll_attempts,
        poll_interval_seconds=settings.poll_interval_seconds,
    )
    decoded = decompress_report_document(downloaded.document)
    artifacts.write_bytes(
        Path("fba-removal", marketplace_id, "report.tsv"),
        decoded,
    )
    parsed = parse_removal_fee_document(decoded, amazon_scope=header.amazon_scope)
    return build_removal_fee_batch_from_parsed(
        downloaded.report_summary,
        parsed,
        settlement_report_id=settlement.report.id,
        seller_namespace=header.seller_namespace,
        amazon_scope=header.amazon_scope,
        marketplace_id=marketplace_id,
        data_start_at=data_start_at,
        data_end_at=header.settlement_end_at,
    )


def _planner_observations(
    batches: Sequence[AuxiliaryFeeBatch],
) -> tuple[AuxiliaryFeeObservation, ...]:
    return tuple(
        AuxiliaryFeeObservation(
            source_system=item.source_system.value,
            marketplace_id=item.marketplace_id,
            source_start_date=item.observed_start_date,
            source_end_date=item.observed_end_date,
            category_code=item.category_code,
            amz_sku=item.amz_sku,
            currency=item.currency,
            reported_amount=item.reported_amount,
            normalized_amount=item.normalized_amount,
            quantity=item.quantity,
            removal_order_id=item.removal_order_id,
        )
        for batch in batches
        for item in batch.observations
    )


def _aware_now(value: datetime | None) -> datetime:
    resolved = value or datetime.now(UTC)
    if resolved.tzinfo is None or resolved.utcoffset() is None:
        raise ValueError("Auxiliary acquisition time must be timezone-aware.")
    return resolved.astimezone(UTC)


__all__ = [
    "AuxiliaryAcquisitionSettings",
    "AuxiliaryClients",
    "acquire_auxiliary_observations",
]
