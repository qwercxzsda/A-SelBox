"""Amazon-facing download-and-parse stage for Settlement V2 reports."""

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from ..amazon.datetimes import as_utc
from ..amazon.reports.decoding import decompress_report_document
from ..amazon.reports.discovery import (
    SettlementReportDiscoveryResult,
    discover_settlement_reports,
)
from ..amazon.reports.documents import download_report_document
from ..amazon.reports.sdk_types import SettlementReportsClient
from ..amazon.scopes import validate_amazon_scope
from ..amazon.settlement_models import SettlementReportReference
from ..amazon.settlement_parser import parse_settlement_report
from ..database.connection import DatabaseConnection
from ..database.seller_namespaces import validate_seller_namespace
from ..database.settlement_report_repository import (
    SettlementReportPersistenceOutcome,
    persist_settlement_report,
    select_settlement_reports_to_download,
)

logger: logging.Logger = logging.getLogger(__name__)
_DISCOVERY_LOOKBACK = timedelta(days=90)


@dataclass(frozen=True, slots=True, kw_only=True)
class SettlementDownloadAndParseResult:
    """Terminal outcomes for every report in one 90-day discovery audit."""

    listed_count: int
    inserted_count: int
    already_stored_count: int
    identity_anomaly_count: int
    download_failed_count: int
    parse_failed_count: int
    persistence_failed_count: int

    def __post_init__(self) -> None:
        counts = (
            self.listed_count,
            self.inserted_count,
            self.already_stored_count,
            self.identity_anomaly_count,
            self.download_failed_count,
            self.parse_failed_count,
            self.persistence_failed_count,
        )
        if any(type(count) is not int for count in counts):
            raise TypeError("Settlement download-and-parse counts must be integers.")
        if any(count < 0 for count in counts):
            raise ValueError("Settlement download-and-parse counts must not be negative.")
        if self.terminal_count != self.listed_count:
            raise ValueError("Settlement download-and-parse outcomes must cover the listing.")

    @property
    def terminal_count(self) -> int:
        """Count reports assigned exactly one terminal outcome."""
        return self.inserted_count + self.already_stored_count + self.failed_count

    @property
    def failed_count(self) -> int:
        """Count anomalies or failures that make the audit incomplete."""
        return (
            self.identity_anomaly_count
            + self.download_failed_count
            + self.parse_failed_count
            + self.persistence_failed_count
        )


def download_and_parse_settlement_reports(
    client: SettlementReportsClient,
    database: DatabaseConnection,
    *,
    amazon_scope: str,
    marketplace_ids: Sequence[str],
    marketplace_names_by_id: Mapping[str, str],
    seller_namespace: str,
) -> SettlementDownloadAndParseResult:
    """Discover, download, parse, and atomically store successful reports."""
    scope = validate_amazon_scope(amazon_scope)
    seller = validate_seller_namespace(seller_namespace)
    discovery = _list_recent_reports(
        client,
        amazon_scope=scope,
        marketplace_ids=marketplace_ids,
    )
    selection = select_settlement_reports_to_download(
        database,
        amazon_scope=scope,
        report_references=discovery.reports,
        seller_namespace=seller,
    )

    for _identity_anomaly in range(selection.identity_anomaly_count):
        logger.error(
            "Settlement report identity anomaly; skipping document.",
            extra={"amazon_scope": scope},
        )

    inserted_count = 0
    already_stored_count = selection.already_stored_count
    identity_anomaly_count = discovery.identity_anomaly_count + selection.identity_anomaly_count
    download_failed_count = 0
    parse_failed_count = 0
    persistence_failed_count = 0

    for reference in sorted(selection.download_candidates, key=_report_storage_order):
        try:
            downloaded_document = download_report_document(
                client,
                reference.report_document_id,
            )
        except Exception as error:
            download_failed_count += 1
            logger.error(
                "Settlement report download failed (%s).",
                type(error).__name__,
                extra={"amazon_scope": scope},
            )
            continue

        try:
            report_content = decompress_report_document(downloaded_document)
            parsed_report = parse_settlement_report(report_content)
        except Exception as error:
            parse_failed_count += 1
            logger.error(
                "Settlement report parse failed (%s).",
                type(error).__name__,
                extra={"amazon_scope": scope},
            )
            continue

        try:
            persistence_outcome = persist_settlement_report(
                database,
                parsed_report,
                reference,
                marketplace_names_by_id=marketplace_names_by_id,
                seller_namespace=seller,
                amazon_scope=scope,
            )
        except Exception as error:
            persistence_failed_count += 1
            logger.error(
                "Settlement report persistence failed (%s).",
                type(error).__name__,
                extra={"amazon_scope": scope},
            )
            continue

        if persistence_outcome is SettlementReportPersistenceOutcome.INSERTED:
            inserted_count += 1
            logger.info(
                "Inserted parsed settlement report.",
                extra={
                    "amazon_scope": scope,
                    "content_row_count": parsed_report.content_row_count,
                },
            )
        elif persistence_outcome is SettlementReportPersistenceOutcome.EXACT_RERUN:
            already_stored_count += 1
        else:
            identity_anomaly_count += 1
            logger.error(
                "Settlement report identity anomaly after download; skipping document.",
                extra={"amazon_scope": scope},
            )

    return SettlementDownloadAndParseResult(
        listed_count=discovery.listed_count,
        inserted_count=inserted_count,
        already_stored_count=already_stored_count,
        identity_anomaly_count=identity_anomaly_count,
        download_failed_count=download_failed_count,
        parse_failed_count=parse_failed_count,
        persistence_failed_count=persistence_failed_count,
    )


def _list_recent_reports(
    client: SettlementReportsClient,
    *,
    amazon_scope: str,
    marketplace_ids: Sequence[str],
) -> SettlementReportDiscoveryResult:
    query_until = datetime.now(UTC)
    return discover_settlement_reports(
        client,
        marketplace_ids=marketplace_ids,
        amazon_scope=amazon_scope,
        created_since=query_until - _DISCOVERY_LOOKBACK,
        created_until=query_until,
    )


def _report_storage_order(
    report: SettlementReportReference,
) -> tuple[datetime, str, str]:
    return (
        as_utc(report.report_created_at),
        report.report_id,
        report.report_document_id,
    )


__all__ = [
    "SettlementDownloadAndParseResult",
    "download_and_parse_settlement_reports",
]
