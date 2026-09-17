"""Validated manifests shared by acquisition and offline preprocessing."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import PurePosixPath
from uuid import UUID

from ..amazon.data_kiosk.models import DataKioskDocumentKind
from ..amazon.datetimes import as_utc
from ..amazon.identifiers import validate_marketplace_id
from ..amazon.scopes import validate_amazon_scope
from ..amazon.settlement_models import SettlementReportReference
from ..canonical_values import validate_sha256
from ..database.seller_namespaces import validate_seller_namespace
from ..frozen_values import freeze_mapping


def archive_path(value: str) -> str:
    """Require a relative object path without URL or traversal syntax."""
    if (
        not value
        or value != value.strip()
        or value.startswith("/")
        or ":" in value
        or "\\" in value
        or any(part in {"", ".", ".."} for part in value.split("/"))
        or str(PurePosixPath(value)) != value
    ):
        raise ValueError("Archive location must be a canonical relative object path.")
    return value


@dataclass(frozen=True, slots=True, kw_only=True)
class ArchivedDocument:
    """Stable object location and independent source/archive integrity evidence."""

    bucket: str
    object_path: str
    document_sha256: str
    document_byte_length: int
    archive_sha256: str
    archive_byte_length: int
    source_compression: str | None
    archive_codec: str = "xz"
    archive_preset: str = "2e"
    archive_check: str = "CRC64"

    def __post_init__(self) -> None:
        archive_path(self.bucket)
        if "/" in self.bucket:
            raise ValueError("Archive bucket cannot contain a slash.")
        archive_path(self.object_path)
        if not self.object_path.endswith(".xz"):
            raise ValueError("Archive object must use an .xz suffix.")
        validate_sha256(self.document_sha256, "document_sha256")
        validate_sha256(self.archive_sha256, "archive_sha256")
        for length in (self.document_byte_length, self.archive_byte_length):
            if type(length) is not int or length < 0:
                raise ValueError("Archive and document lengths must be nonnegative integers.")
        if self.archive_byte_length == 0:
            raise ValueError("A complete XZ archive cannot be empty.")
        if (self.archive_codec, self.archive_preset, self.archive_check) != ("xz", "2e", "CRC64"):
            raise ValueError("Source archives must use XZ 2e with CRC64.")
        if self.source_compression not in (None, "GZIP"):
            raise ValueError("Unsupported source compression declaration.")


@dataclass(frozen=True, slots=True, kw_only=True)
class SettlementAcquisition:
    """One complete archived Reports API document, before any TSV parsing."""

    id: UUID
    seller_namespace: str
    amazon_scope: str
    reference: SettlementReportReference
    downloaded_at: datetime
    document: ArchivedDocument
    api_metadata: Mapping[str, object] = field(default_factory=dict[str, object], repr=False)

    def __post_init__(self) -> None:
        _validate_identity(self.id, self.amazon_scope, self.downloaded_at)
        object.__setattr__(
            self, "seller_namespace", validate_seller_namespace(self.seller_namespace)
        )
        as_utc(self.reference.report_created_at)
        object.__setattr__(
            self, "api_metadata", freeze_mapping(self.api_metadata, field_name="api_metadata")
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class ArchivedDataKioskPage:
    """One successful API page and its whole document, or explicit DONE no-data metadata."""

    page_number: int
    query_id: str
    query_created_at: datetime
    document_kind: DataKioskDocumentKind
    is_terminal: bool
    document_id: str | None
    document: ArchivedDocument | None
    api_metadata: Mapping[str, object] = field(repr=False)

    def __post_init__(self) -> None:
        if type(self.page_number) is not int or self.page_number < 1:
            raise ValueError("Acquisition pages must have positive page numbers.")
        if not self.query_id or self.query_id != self.query_id.strip():
            raise ValueError("Acquisition page requires its query identity.")
        as_utc(self.query_created_at)
        if type(self.is_terminal) is not bool:
            raise ValueError("Page terminal flag must be boolean.")
        if self.document_kind is DataKioskDocumentKind.DATA:
            if not self.document_id or self.document is None:
                raise ValueError("A data page requires a complete archived document.")
        elif self.document_kind is DataKioskDocumentKind.NO_DATA:
            if self.document_id is not None or self.document is not None:
                raise ValueError("A no-data page cannot claim document contents.")
        else:
            raise ValueError("Failed query pages cannot publish successful acquisitions.")
        if self.api_metadata.get("processingStatus") != "DONE":
            raise ValueError("Acquisition requires a successful terminal API response.")
        if self.api_metadata.get("queryId") != self.query_id:
            raise ValueError("Page API response identity does not match its manifest.")
        object.__setattr__(
            self, "api_metadata", freeze_mapping(self.api_metadata, field_name="api_metadata")
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class DataKioskAcquisition:
    """Complete ordered pages for one independent source observation."""

    id: UUID
    seller_namespace: str
    amazon_scope: str
    root_query_id: str
    root_query_created_at: datetime
    query_definition: str
    schema_version: str
    marketplace_id: str
    query_start_date: date
    query_end_date: date
    downloaded_at: datetime
    pages: tuple[ArchivedDataKioskPage, ...]
    api_metadata: Mapping[str, object] = field(repr=False)

    def __post_init__(self) -> None:
        _validate_identity(self.id, self.amazon_scope, self.downloaded_at)
        object.__setattr__(
            self, "seller_namespace", validate_seller_namespace(self.seller_namespace)
        )
        as_utc(self.root_query_created_at)
        validate_marketplace_id(self.marketplace_id)
        if not self.query_definition.strip() or not self.schema_version.strip():
            raise ValueError("Acquisition requires its schema and full query definition.")
        if type(self.query_start_date) is not date or type(self.query_end_date) is not date:
            raise TypeError("Acquisition coverage must use local calendar dates.")
        if self.query_start_date > self.query_end_date:
            raise ValueError("Acquisition coverage dates are reversed.")
        if not self.pages or tuple(page.page_number for page in self.pages) != tuple(
            range(1, len(self.pages) + 1)
        ):
            raise ValueError("Acquisition pages must be complete and consecutively ordered.")
        if tuple(page.is_terminal for page in self.pages) != (False,) * (len(self.pages) - 1) + (
            True,
        ):
            raise ValueError("Only the final acquisition page can be terminal.")
        root = self.pages[0]
        if (self.root_query_id, self.root_query_created_at) != (
            root.query_id,
            root.query_created_at,
        ):
            raise ValueError("Root query identity and source observation time must match page one.")
        query_ids = tuple(page.query_id for page in self.pages)
        document_ids = tuple(
            page.document_id for page in self.pages if page.document_id is not None
        )
        if len(set(query_ids)) != len(query_ids) or len(set(document_ids)) != len(document_ids):
            raise ValueError("Acquisition query and document inventories must be unique.")
        object.__setattr__(
            self, "api_metadata", freeze_mapping(self.api_metadata, field_name="api_metadata")
        )


def _validate_identity(identifier: UUID, scope: str, downloaded_at: datetime) -> None:
    if identifier.version != 7:
        raise ValueError("Acquisition identifiers must be generated UUIDv7 values.")
    validate_amazon_scope(scope)
    as_utc(downloaded_at)
