"""Amazon discovery and lossless Settlement archive publication; no body parsing."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid7

from ..amazon.reports.decoding import decompress_report_document
from ..amazon.reports.discovery import discover_settlement_reports
from ..amazon.reports.documents import download_report_document
from ..amazon.reports.sdk_types import SettlementReportsClient
from ..amazon.scopes import validate_amazon_scope
from ..amazon.settlement_models import SettlementReportReference
from ..archives.acquisition_logging import AcquisitionLog
from ..archives.models import SettlementAcquisition
from ..archives.storage import ArchiveStorage, archive_document
from ..database.acquisitions import persist_settlement_acquisition
from ..database.connection import DatabaseConnection
from ..database.seller_namespaces import validate_seller_namespace


@dataclass(frozen=True, slots=True)
class SettlementDownloadResult:
    """Terminal successful archive and failure counts for a discovery window."""

    listed_count: int
    archived_count: int
    failed_count: int


def download_settlement_reports(
    client: SettlementReportsClient,
    database: DatabaseConnection,
    storage: ArchiveStorage,
    *,
    amazon_scope: str,
    marketplace_ids: Sequence[str],
    seller_namespace: str,
) -> SettlementDownloadResult:
    """Retain each completed immutable document before publishing its manifest."""
    scope = validate_amazon_scope(amazon_scope)
    seller = validate_seller_namespace(seller_namespace)
    until = datetime.now(UTC)
    discovery = discover_settlement_reports(
        client,
        marketplace_ids=marketplace_ids,
        amazon_scope=scope,
        created_since=until - timedelta(days=90),
        created_until=until,
    )
    archived_count = 0
    failed_count = discovery.identity_anomaly_count
    for reference in sorted(
        discovery.reports,
        key=lambda item: (item.report_created_at, item.report_id, item.report_document_id),
    ):
        try:
            archive_settlement_report(
                client, database, storage, reference, amazon_scope=scope, seller_namespace=seller
            )
        except Exception:
            failed_count += 1
        else:
            archived_count += 1
    return SettlementDownloadResult(discovery.listed_count, archived_count, failed_count)


def archive_settlement_report(
    client: SettlementReportsClient,
    database: DatabaseConnection,
    storage: ArchiveStorage,
    reference: SettlementReportReference,
    *,
    amazon_scope: str,
    seller_namespace: str,
) -> str:
    """Archive a whole report even when its financial contents are invalid."""
    with AcquisitionLog(
        "settlement",
        seller_namespace=seller_namespace,
        amazon_scope=amazon_scope,
        report_id=reference.report_id,
        report_document_id=reference.report_document_id,
    ) as activity:
        validate_amazon_scope(amazon_scope)
        seller_namespace = validate_seller_namespace(seller_namespace)
        if not reference.api_metadata:
            raise ValueError("Settlement acquisition requires its original Reports API metadata.")
        activity.step("download", seller_namespace=seller_namespace)
        transferred = download_report_document(client, reference.report_document_id)
        activity.step("archive")
        document = archive_document(
            storage,
            decompress_report_document(transferred),
            source_compression=transferred.compression_algorithm,
            acquisition_log=activity,
        )
        activity.step("manifest_validation")
        acquisition = SettlementAcquisition(
            id=uuid7(),
            seller_namespace=seller_namespace,
            amazon_scope=amazon_scope,
            reference=reference,
            downloaded_at=datetime.now(UTC),
            document=document,
            api_metadata=reference.api_metadata,
        )
        activity.step("publication", candidate_acquisition_id=str(acquisition.id))
        acquisition_id = persist_settlement_acquisition(database, acquisition)
        activity.published(acquisition_id)
        return acquisition_id
