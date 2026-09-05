"""Selection and atomic persistence for parsed Settlement V2 reports."""

from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import cast

from ..amazon.datetimes import as_utc
from ..amazon.scopes import validate_amazon_scope
from ..amazon.settlement_models import (
    ParsedSettlementReport,
    SettlementReportContentRow,
    SettlementReportReference,
)
from .connection import DatabaseConnection
from .seller_namespaces import validate_seller_namespace
from .settlement_report_queries import (
    INSERT_SETTLEMENT_REPORT_ROW_SQL,
    INSERT_SETTLEMENT_REPORT_SQL,
    LOCK_SETTLEMENT_IDENTITIES_SQL,
    SELECT_MATCHING_SETTLEMENT_IDENTITIES_SQL,
    SELECT_STORED_SETTLEMENT_IDENTITIES_SQL,
)
from .values import normalize_uuid

STORED_REPORT_LOOKUP_BATCH_SIZE: int = 1000


@dataclass(frozen=True, slots=True)
class SettlementReportCandidateSelection:
    """Database classification of one complete Reports API listing."""

    download_candidates: tuple[SettlementReportReference, ...]
    already_stored_count: int
    identity_anomaly_count: int

    def __post_init__(self) -> None:
        counts = (self.already_stored_count, self.identity_anomaly_count)
        if any(type(count) is not int for count in counts):
            raise TypeError("Settlement report selection counts must be integers.")
        if any(count < 0 for count in counts):
            raise ValueError("Settlement report selection counts must not be negative.")


class SettlementReportPersistenceOutcome(Enum):
    """Terminal transaction outcome for one parsed report."""

    INSERTED = "INSERTED"
    EXACT_RERUN = "EXACT_RERUN"
    IDENTITY_ANOMALY = "IDENTITY_ANOMALY"


@dataclass(frozen=True, slots=True)
class _SettlementReportIdentity:
    report_id: str
    document_id: str
    report_created_at: datetime
    marketplace_ids: tuple[str, ...]
    report_data_start_at: datetime | None
    report_data_end_at: datetime | None


def _require_identifier(value: object, field_name: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{field_name} must be a string.")
    if not value or value != value.strip():
        raise ValueError(f"{field_name} must be nonblank canonical text.")
    return value


def _require_aware_datetime(value: object, field_name: str) -> datetime:
    if not isinstance(value, datetime):
        raise TypeError(f"{field_name} must be a datetime.")
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware.")
    return as_utc(value)


def _optional_aware_datetime(value: object, field_name: str) -> datetime | None:
    if value is None:
        return None
    return _require_aware_datetime(value, field_name)


def _normalize_marketplace_ids(value: object) -> tuple[str, ...]:
    if isinstance(value, str) or not isinstance(value, Sequence):
        raise TypeError("marketplace_ids must be a sequence of strings.")

    marketplace_ids: list[str] = []
    seen_ids: set[str] = set()
    for marketplace_id in cast(Sequence[object], value):
        normalized_id = _require_identifier(marketplace_id, "marketplace_id")
        if normalized_id in seen_ids:
            raise ValueError("marketplace_ids must not contain duplicates.")
        marketplace_ids.append(normalized_id)
        seen_ids.add(normalized_id)
    if not marketplace_ids:
        raise ValueError("marketplace_ids must not be empty.")
    return tuple(marketplace_ids)


def _reference_identity(reference: SettlementReportReference) -> _SettlementReportIdentity:
    report_data_start_at = _optional_aware_datetime(
        reference.report_data_start_at,
        "report_data_start_at",
    )
    report_data_end_at = _optional_aware_datetime(
        reference.report_data_end_at,
        "report_data_end_at",
    )
    if (
        report_data_start_at is not None
        and report_data_end_at is not None
        and report_data_start_at > report_data_end_at
    ):
        raise ValueError("Settlement report data start must not be after its end.")
    return _SettlementReportIdentity(
        report_id=_require_identifier(reference.report_id, "report_id"),
        document_id=_require_identifier(reference.report_document_id, "report_document_id"),
        report_created_at=_require_aware_datetime(
            reference.report_created_at,
            "report_created_at",
        ),
        marketplace_ids=_normalize_marketplace_ids(reference.marketplace_ids),
        report_data_start_at=report_data_start_at,
        report_data_end_at=report_data_end_at,
    )


def _stored_identity(row: tuple[object, ...]) -> _SettlementReportIdentity:
    if len(row) != 6:
        raise TypeError("Stored settlement identity query returned an unexpected shape.")
    (
        report_id,
        document_id,
        report_created_at,
        marketplace_ids,
        report_data_start_at,
        report_data_end_at,
    ) = row
    return _SettlementReportIdentity(
        report_id=_require_identifier(report_id, "stored_report_id"),
        document_id=_require_identifier(document_id, "stored_document_id"),
        report_created_at=_require_aware_datetime(
            report_created_at,
            "stored_report_created_at",
        ),
        marketplace_ids=_normalize_marketplace_ids(marketplace_ids),
        report_data_start_at=_optional_aware_datetime(
            report_data_start_at,
            "stored_report_data_start_at",
        ),
        report_data_end_at=_optional_aware_datetime(
            report_data_end_at,
            "stored_report_data_end_at",
        ),
    )


def select_settlement_reports_to_download(
    database: DatabaseConnection,
    *,
    amazon_scope: str,
    report_references: Sequence[SettlementReportReference],
    seller_namespace: str,
) -> SettlementReportCandidateSelection:
    """Classify exact reruns and identity anomalies before any download."""
    seller = validate_seller_namespace(seller_namespace)
    scope = validate_amazon_scope(amazon_scope)
    identities = tuple(_reference_identity(reference) for reference in report_references)
    if not report_references:
        return SettlementReportCandidateSelection((), 0, 0)

    candidates: list[SettlementReportReference] = []
    already_stored_count = 0
    identity_anomaly_count = 0
    with database.connection() as connection, connection.cursor() as cursor:
        for offset in range(0, len(report_references), STORED_REPORT_LOOKUP_BATCH_SIZE):
            reference_batch = report_references[offset : offset + STORED_REPORT_LOOKUP_BATCH_SIZE]
            identity_batch = identities[offset : offset + STORED_REPORT_LOOKUP_BATCH_SIZE]
            cursor.execute(
                SELECT_STORED_SETTLEMENT_IDENTITIES_SQL,
                {
                    "seller_namespace": seller,
                    "amazon_scope": scope,
                    "amazon_report_ids": [identity.report_id for identity in identity_batch],
                    "amazon_document_ids": [identity.document_id for identity in identity_batch],
                },
            )
            matches_by_ordinal: dict[int, list[_SettlementReportIdentity]] = {}
            for row in cursor.fetchall():
                if len(row) != 7:
                    raise TypeError("Settlement candidate query returned an unexpected shape.")
                ordinal_value, *stored_values = row
                if type(ordinal_value) is not int or not 1 <= ordinal_value <= len(reference_batch):
                    raise ValueError("Settlement candidate query returned an invalid ordinal.")
                matches_by_ordinal.setdefault(ordinal_value, []).append(
                    _stored_identity(tuple(stored_values))
                )

            for ordinal, (reference, identity) in enumerate(
                zip(reference_batch, identity_batch, strict=True),
                start=1,
            ):
                stored_matches = matches_by_ordinal.get(ordinal, [])
                if not stored_matches:
                    candidates.append(reference)
                elif stored_matches == [identity]:
                    already_stored_count += 1
                else:
                    identity_anomaly_count += 1

    return SettlementReportCandidateSelection(
        tuple(candidates),
        already_stored_count,
        identity_anomaly_count,
    )


def _report_insert_parameters(
    parsed_report: ParsedSettlementReport,
    identity: _SettlementReportIdentity,
    marketplace_names_by_id: Mapping[str, str],
    *,
    seller_namespace: str,
    amazon_scope: str,
) -> dict[str, object]:
    marketplace_names = _marketplace_names(
        identity.marketplace_ids,
        marketplace_names_by_id,
    )
    return {
        "seller_namespace": seller_namespace,
        "amazon_scope": amazon_scope,
        "amazon_report_id": identity.report_id,
        "amazon_document_id": identity.document_id,
        "amazon_report_created_at": identity.report_created_at,
        "amazon_report_data_start_at": identity.report_data_start_at,
        "amazon_report_data_end_at": identity.report_data_end_at,
        "marketplace_ids": list(identity.marketplace_ids),
        "marketplace_names": list(marketplace_names),
        "tsv_columns": list(parsed_report.tsv_columns),
        "metadata_source_line_number": parsed_report.metadata_source_line_number,
        "metadata_values": list(parsed_report.metadata_values),
        "decoded_content_sha256": parsed_report.decoded_content_sha256,
        "content_row_count": parsed_report.content_row_count,
    }


def _marketplace_names(
    marketplace_ids: Sequence[str],
    marketplace_names_by_id: Mapping[str, str],
) -> tuple[str, ...]:
    names: list[str] = []
    for marketplace_id in marketplace_ids:
        marketplace_name = marketplace_names_by_id.get(marketplace_id)
        if marketplace_name is None:
            raise ValueError("A Settlement report marketplace has no active marketplace name.")
        names.append(_require_identifier(marketplace_name, "marketplace_name"))
    return tuple(names)


def _iter_row_insert_parameters(
    rows: Sequence[SettlementReportContentRow],
    settlement_report_id: str,
) -> Iterator[dict[str, object]]:
    for row in rows:
        yield {
            "settlement_report_id": settlement_report_id,
            "source_line_number": row.source_line_number,
            "column_values": list(row.column_values),
        }


def persist_settlement_report(
    database: DatabaseConnection,
    parsed_report: ParsedSettlementReport,
    report_reference: SettlementReportReference,
    *,
    marketplace_names_by_id: Mapping[str, str],
    seller_namespace: str,
    amazon_scope: str,
) -> SettlementReportPersistenceOutcome:
    """Atomically insert one parsed report and all of its retained content rows."""
    seller = validate_seller_namespace(seller_namespace)
    scope = validate_amazon_scope(amazon_scope)
    identity = _reference_identity(report_reference)
    report_parameters = _report_insert_parameters(
        parsed_report,
        identity,
        marketplace_names_by_id,
        seller_namespace=seller,
        amazon_scope=scope,
    )

    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor() as cursor,
    ):
        cursor.execute(LOCK_SETTLEMENT_IDENTITIES_SQL, report_parameters)
        cursor.execute(SELECT_MATCHING_SETTLEMENT_IDENTITIES_SQL, report_parameters)
        stored_identities = [_stored_identity(row) for row in cursor.fetchall()]
        if stored_identities:
            if stored_identities == [identity]:
                return SettlementReportPersistenceOutcome.EXACT_RERUN
            return SettlementReportPersistenceOutcome.IDENTITY_ANOMALY

        cursor.execute(INSERT_SETTLEMENT_REPORT_SQL, report_parameters)
        inserted_row = cursor.fetchone()
        if inserted_row is None:
            raise RuntimeError("Settlement report insert returned no identity.")
        settlement_report_id = normalize_uuid(inserted_row[0], "settlement_report_id")

        if parsed_report.content_rows:
            cursor.executemany(
                INSERT_SETTLEMENT_REPORT_ROW_SQL,
                _iter_row_insert_parameters(
                    parsed_report.content_rows,
                    settlement_report_id,
                ),
            )

    return SettlementReportPersistenceOutcome.INSERTED


__all__ = [
    "STORED_REPORT_LOOKUP_BATCH_SIZE",
    "SettlementReportCandidateSelection",
    "SettlementReportPersistenceOutcome",
    "persist_settlement_report",
    "select_settlement_reports_to_download",
]
