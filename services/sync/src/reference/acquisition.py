"""Archive each answer and its request context before any source validation."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any, cast
from uuid import uuid7

from sp_api.api import Reports

from ..amazon.client import create_explicit_sp_api_client
from ..amazon.credentials import close_quietly, load_lwa_credentials
from ..amazon.marketplaces import get_credential_scope, validate_marketplace_scope_pair
from ..amazon.reports.decoding import decompress_report_document
from ..amazon.reports.documents import download_report_document
from ..amazon.reports.jobs import ReportsClient, request_report, safe_report_metadata
from ..archives.manifests import write_manifest
from ..archives.storage import ArchiveStorage, archive_document
from ..seller_namespaces import validate_seller_namespace
from ..source_serialization import source_mapping
from .reports import REPORT_TYPES

NAMED_SOURCES = ("AD_INVOICE", "CAMPAIGN", "PROMOTION", "SHIPMENT")


@dataclass(frozen=True)
class ReferenceRequest:
    source: str
    scope: str
    marketplace_id: str
    seller: str
    start_date: date | None = None
    end_date: date | None = None
    native_id: str | None = None
    profile_id: str | None = None
    campaign_aid: str | None = None
    ad_type: str | None = None

    def __post_init__(self) -> None:
        validate_marketplace_scope_pair(self.scope, self.marketplace_id)
        if validate_seller_namespace(self.seller) != self.seller:
            raise ValueError("Invalid seller namespace.")
        if self.source in REPORT_TYPES:
            if (
                self.native_id is not None
                or self.start_date is None
                or self.end_date is None
                or self.start_date >= self.end_date
                or (
                    self.source != "REMOVAL_ORDER"
                    and (self.start_date.day != 1 or self.end_date.day != 1)
                )
            ):
                raise ValueError("Report requests require a calendar month.")
        elif (
            self.source not in NAMED_SOURCES
            or not self.native_id
            or self.start_date is not None
            or self.end_date is not None
        ):
            raise ValueError("Named requests require an Amazon ID.")


def _download_report(
    request: ReferenceRequest, now: datetime
) -> tuple[bytes, str | None, dict[str, object]]:
    if request.start_date is None or request.end_date is None:
        raise ValueError("A report needs a period.")
    start = datetime.combine(request.start_date, time.min, UTC)
    end = min(datetime.combine(request.end_date, time.min, UTC), now)
    if start >= end or (
        request.source != "REMOVAL_ORDER" and request.end_date > now.date().replace(day=1)
    ):
        raise ValueError("This report period is unavailable.")
    options: dict[str, Any] = {
        "dataStartTime": start.isoformat(),
        "dataEndTime": (end - timedelta(seconds=1)).isoformat(),
    }
    if request.source == "INVENTORY_LEDGER":
        options["reportOptions"] = {
            "aggregateByLocation": "COUNTRY",
            "aggregatedByTimePeriod": "MONTHLY",
        }
    scope = get_credential_scope(request.scope)
    client = cast(
        ReportsClient,
        create_explicit_sp_api_client(
            Reports, scope.client_marketplace, load_lwa_credentials(scope.refresh_token_environment)
        ),
    )
    try:
        response = request_report(
            client,
            request.marketplace_id,
            report_type=REPORT_TYPES[request.source],
            options=options,
            allow_cancelled=True,
            max_poll_attempts=240,
        )
        metadata = safe_report_metadata(response)
        if response["processingStatus"] == "CANCELLED":
            return b"", None, metadata
        result = download_report_document(client, str(response["reportDocumentId"]))
        return decompress_report_document(result), result.compression_algorithm, metadata
    finally:
        close_quietly(client)


def download_reference(
    request: ReferenceRequest, storage: ArchiveStorage, manifest_directory: Path
) -> Path:
    from .named_client import download_named

    capture = datetime.now(UTC)
    if request.source in REPORT_TYPES:
        content, compression, metadata = _download_report(request, capture)
    else:
        if request.native_id is None:
            raise ValueError("Missing Amazon ID.")
        content = download_named(
            request.source,
            request.scope,
            request.marketplace_id,
            request.native_id,
            profile_id=request.profile_id,
            campaign_aid=request.campaign_aid,
            ad_type=request.ad_type,
        )
        compression, metadata = None, {}
    document = archive_document(storage, content, source_compression=compression)
    identifier = str(uuid7())
    manifest = manifest_directory / f"{request.source.lower()}-{identifier}.json"
    write_manifest(
        manifest,
        {
            "acquisition_id": identifier,
            "observed_at": capture.isoformat(),
            "downloaded_at": datetime.now(UTC).isoformat(),
            "request": source_mapping(request),
            "document": source_mapping(document),
            "api_metadata": metadata,
        },
    )
    return manifest
