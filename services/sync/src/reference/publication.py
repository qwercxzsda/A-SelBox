"""Validate a complete archived answer before publishing a single atomic observation."""

import json
from collections.abc import Mapping
from datetime import UTC, date, datetime, time
from pathlib import Path
from typing import Any, cast
from uuid import UUID, uuid7

from psycopg import Cursor
from psycopg.types.json import Jsonb

from ..amazon.datetimes import parse_amazon_datetime
from ..archives.serialization import document_from_payload
from ..archives.storage import ArchiveStorage, load_document_archive
from ..database.connection import DatabaseConnection
from ..preprocess_version import PREPROCESS_VERSION
from .acquisition import ReferenceRequest
from .currencies import load_currency_decimals
from .named import prepare_named
from .reports import REPORT_TYPES, prepare_report
from .store import INFO_TABLES, store_information, store_unit


def _check_coverage(
    cursor: Cursor[Any],
    request: ReferenceRequest,
    observed: datetime,
    acquisition_id: UUID,
    start: datetime | None,
    end: datetime | None,
    keys: set[str],
) -> None:
    identity = (request.source, request.seller, request.scope)
    cursor.execute(
        "select pg_advisory_xact_lock_shared(hashtextextended('company_payout_inputs',0))"
    )
    cursor.execute(
        "select pg_advisory_xact_lock(hashtextextended(jsonb_build_array("
        "%s::text,%s::text,%s::text)::text,0))",
        identity,
    )
    cursor.execute(
        "select 1 from private.source_acquisitions where "
        "(source,seller_namespace,amazon_scope)=(%s,%s,%s) "
        "and (capture_started_at,id)>(%s,%s) and (asked_id=%s or (asked_from<%s and "
        "asked_until>%s)) limit 1",
        (*identity, observed, acquisition_id, request.native_id, end, start),
    )
    if cursor.fetchone():
        raise ValueError("A newer answer already covers this ID or period.")
    if request.source == "REMOVAL_ORDER":
        cursor.execute(
            "select distinct u.unit_key from private.source_units u join "
            "private.removal_order_rows r "
            "on r.version_id=u.current_version_id where "
            "(u.source,u.seller_namespace,u.amazon_scope)=(%s,%s,%s) "
            "and r.requested_at >= %s and r.requested_at < %s",
            (*identity, start, end),
        )
        if {key for (key,) in cursor.fetchall()} - keys:
            raise ValueError("A stored removal order is missing from the new report.")


def preprocess_reference(
    database: DatabaseConnection,
    storage: ArchiveStorage,
    manifest: Path,
    currency_decimals: Mapping[str, int] | None = None,
) -> int:
    with manifest.open(encoding="utf-8") as stream:
        evidence = json.load(stream)
    observed = parse_amazon_datetime(evidence["observed_at"])
    downloaded = parse_amazon_datetime(evidence["downloaded_at"])
    acquisition_id = UUID(evidence["acquisition_id"])
    params = dict(evidence["request"])
    for field in ("start_date", "end_date"):
        if params.get(field):
            params[field] = date.fromisoformat(params[field])
    request = ReferenceRequest(**params)
    content = load_document_archive(storage, document_from_payload(evidence["document"]))
    decimals = load_currency_decimals(database) if currency_decimals is None else currency_decimals
    start = datetime.combine(request.start_date, time.min, UTC) if request.start_date else None
    end = (
        min(observed, datetime.combine(request.end_date, time.min, UTC))
        if request.end_date
        else None
    )
    header: dict[str, object] = {}
    missing = False
    positions: dict[str, int] = {}
    if request.source in REPORT_TYPES and request.start_date and request.end_date:
        status = evidence["api_metadata"]["processingStatus"]
        if status not in {"DONE", "CANCELLED"}:
            raise ValueError("Only completed reports can be published.")
        if request.source != "REMOVAL_ORDER" and request.end_date > observed.date().replace(day=1):
            raise ValueError("Monthly reports require finished months.")
        groups = prepare_report(
            request.source,
            content,
            request.scope,
            request.start_date,
            request.end_date,
            decimals,
            cancelled=status == "CANCELLED",
            positions=positions,
            captured_at=observed,
        )
    else:
        if not request.native_id:
            raise ValueError("Missing native ID.")
        named = prepare_named(
            request.source, content, request.marketplace_id, request.native_id, decimals
        )
        missing = named is None
        groups: dict[str, list[dict[str, Any]]] = {}
        if named is not None:
            groups[request.native_id] = cast(list[dict[str, Any]], named.pop("rows"))
            header = named
            if request.source == "CAMPAIGN":
                header["campaign_aid"] = request.campaign_aid
    row_count = sum(map(len, groups.values()))
    result = "UNKNOWN_ID" if missing else ("ROWS" if row_count or header else "EMPTY")
    metadata = {"request": evidence["request"], **evidence["api_metadata"]}
    documents = [evidence["document"]]
    batch_id = uuid7()
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor() as cursor,
    ):
        _check_coverage(cursor, request, observed, acquisition_id, start, end, set(groups))
        cursor.execute(
            "select source,seller_namespace,amazon_scope,api_metadata,documents,"
            "capture_started_at,downloaded_at "
            "from private.source_acquisitions where id=%s",
            (acquisition_id,),
        )
        saved = cursor.fetchone()
        if saved is not None:
            if saved != (
                request.source,
                request.seller,
                request.scope,
                metadata,
                documents,
                observed,
                downloaded,
            ):
                raise ValueError("Acquisition identifier already belongs to a different answer.")
        else:
            cursor.execute(
                "insert into private.source_acquisitions(id,source,seller_namespace,amazon_scope,"
                "asked_from,asked_until,asked_id,result,capture_started_at,"
                "downloaded_at,api_metadata,documents) "
                "values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    acquisition_id,
                    request.source,
                    request.seller,
                    request.scope,
                    start,
                    end,
                    request.native_id,
                    result,
                    observed,
                    downloaded,
                    Jsonb(metadata),
                    Jsonb(documents),
                ),
            )
        info = request.source in INFO_TABLES
        cursor.execute(
            "insert into private.source_preprocess_batches(id,acquisition_id,preprocess_version,"
            "unit_count,row_count) values(%s,%s,%s,%s,%s)",
            (batch_id, acquisition_id, PREPROCESS_VERSION, 0 if info else len(groups), row_count),
        )
        if info:
            store_information(
                cursor,
                request,
                batch_id,
                header,
                next(iter(groups.values()), list[dict[str, Any]]()),
                missing=missing,
            )
        elif groups:
            changed = False
            for key, rows in groups.items():
                changed |= store_unit(
                    cursor, request, batch_id, key, rows, header, positions.get(key, 1)
                )
            if changed:
                cursor.execute("select private.request_all_payout_report_refreshes()")
    return row_count
