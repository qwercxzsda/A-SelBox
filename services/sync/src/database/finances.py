"""Atomically accept validated transaction revisions and complete observation memberships."""

from collections.abc import Mapping, Sequence
from datetime import date, timedelta
from typing import Any
from uuid import uuid7

from psycopg import Cursor
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from ..finances.acquisition_models import FinancesAcquisition
from ..finances.acquisition_serialization import (
    finances_acquisition_from_payload,
    finances_acquisition_payload,
)
from ..finances.models import FinancesComponent, FinancesTransaction, PreparedFinances
from ..finances.validation import revision_digest, validate_finances_candidate
from ..preprocess_version import PREPROCESS_VERSION
from .connection import DatabaseConnection
from .source_writes import copy_rows, require_read_committed
from .values import required_text


def publish_finances(
    database: DatabaseConnection,
    acquisition: FinancesAcquisition,
    prepared: PreparedFinances,
    *,
    preprocess_version: str = PREPROCESS_VERSION,
) -> str:
    """Validate after scoped locks, then commit all accepted evidence or nothing.

    Downloading only writes archives/local manifests. Acquisition metadata enters
    PostgreSQL together with its first successful preprocessing run. A repeated
    state reuses its revision while recording this observation's own membership.
    """
    preprocess_version = required_text(preprocess_version, "preprocess_version")
    batch_id = str(uuid7())
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor(row_factory=dict_row) as cursor,
    ):
        require_read_committed(cursor)
        cursor.execute(
            "SELECT pg_advisory_xact_lock_shared(hashtextextended('company_payout_inputs',0))"
        )
        cursor.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array("
            "'finances-native-identity',%s::text,%s::text)::text,0))",
            (acquisition.seller_namespace, acquisition.amazon_scope),
        )
        accepted = _current_transactions(cursor, acquisition)
        observations = _overlapping_observations(cursor, acquisition)
        candidate = validate_finances_candidate(acquisition, prepared, accepted, observations)
        _persist_acquisition(cursor, acquisition, bool(candidate.transactions))
        cursor.execute(
            "INSERT INTO private.source_preprocess_batches "
            "(id,acquisition_id,preprocess_version,unit_count,row_count) "
            "VALUES (%s,%s,%s,%s,%s)",
            (
                batch_id,
                str(acquisition.id),
                preprocess_version,
                len(candidate.transactions),
                sum(len(row.components) for row in candidate.transactions),
            ),
        )
        changed = _persist_transactions(
            cursor, acquisition, candidate.transactions, accepted, batch_id
        )
        if changed:
            # Customer orders and removals can change a different posting month.
            cursor.execute("SELECT private.request_all_payout_report_refreshes()")
        cursor.execute(
            "SELECT private.request_payout_report_refresh(%s::date[])",
            (sorted(_affected_months(acquisition, candidate.transactions, accepted)),),
        )
    return batch_id


def _affected_months(
    acquisition: FinancesAcquisition,
    transactions: Sequence[FinancesTransaction],
    accepted: Sequence[Mapping[str, Any]],
) -> set[date]:
    """Refresh changed records' old/new months and newly reconciled empty months."""
    months = {row.posted_date.replace(day=1) for row in transactions}
    incoming_ids = {row.native_transaction_id for row in transactions}
    months.update(
        row["posted_date"].replace(day=1)
        for row in accepted
        if row["native_transaction_id"] in incoming_ids
    )
    start, end = acquisition.reconciliation_start_date, acquisition.reconciliation_end_date
    if start is not None and end is not None:
        month = start.replace(day=1)
        while month <= end:
            months.add(month)
            month = (month + timedelta(days=32)).replace(day=1)
    return months


def _current_transactions(
    cursor: Cursor[dict[str, Any]], acquisition: FinancesAcquisition
) -> list[dict[str, Any]]:
    cursor.execute(
        "SELECT t.id,t.unit_key as native_transaction_id,t.current_version_id,t.current_batch_id,"
        "v.posted_date,v.posted_at,v.marketplace_id,v.marketplace_name,v.account_type,"
        "v.transaction_type,v.transaction_status,v.deferred_transaction_id,v.release_transaction_id,"
        "v.is_activity as activity_eligible,v.total_amount,v.currency,a.id AS "
        "acquisition_id,a.capture_started_at "
        "FROM private.source_units t "
        "JOIN private.finances_transactions v ON v.version_id=t.current_version_id "
        "JOIN private.source_preprocess_batches r ON r.id=t.current_batch_id "
        "JOIN private.source_acquisitions a ON a.id=r.acquisition_id "
        "WHERE t.source='FINANCES' AND t.seller_namespace=%s AND t.amazon_scope=%s",
        (acquisition.seller_namespace, acquisition.amazon_scope),
    )
    return cursor.fetchall()


def _overlapping_observations(
    cursor: Cursor[dict[str, Any]], acquisition: FinancesAcquisition
) -> list[dict[str, Any]]:
    cursor.execute(
        "SELECT a.id,a.capture_started_at FROM private.source_acquisitions a "
        "WHERE a.source='FINANCES' AND a.seller_namespace=%s AND a.amazon_scope=%s "
        "AND a.asked_from<%s "
        "AND coalesce(a.asked_until,a.capture_started_at-interval '2 minutes')>%s "
        "AND a.marketplace_ids && %s::text[] "
        "AND EXISTS(SELECT 1 FROM private.source_preprocess_batches r WHERE "
        "r.acquisition_id=a.id)",
        (
            acquisition.seller_namespace,
            acquisition.amazon_scope,
            acquisition.comparable_end_at,
            acquisition.posted_after,
            list(acquisition.marketplace_ids),
        ),
    )
    return cursor.fetchall()


def _persist_acquisition(
    cursor: Cursor[dict[str, Any]], acquisition: FinancesAcquisition, has_rows: bool
) -> None:
    cursor.execute(
        "SELECT *,asked_from as posted_after,asked_until as posted_before FROM "
        "private.source_acquisitions WHERE id=%s",
        (str(acquisition.id),),
    )
    existing = cursor.fetchone()
    if existing is not None:
        if finances_acquisition_from_payload(existing) != acquisition:
            raise ValueError(
                "A saved Finances acquisition cannot be replaced by a different manifest."
            )
        return
    payload = finances_acquisition_payload(acquisition)
    cursor.execute(
        "INSERT INTO private.source_acquisitions "
        "(id,source,result,seller_namespace,amazon_scope,api_version,capture_started_at,downloaded_at,"
        "asked_from,asked_until,reconciliation_start_date,reconciliation_end_date,"
        "marketplace_ids,api_metadata,documents) "
        "VALUES (%s,'FINANCES',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            str(acquisition.id),
            "ROWS" if has_rows else "EMPTY",
            acquisition.seller_namespace,
            acquisition.amazon_scope,
            acquisition.api_version,
            acquisition.capture_started_at,
            acquisition.downloaded_at,
            acquisition.posted_after,
            acquisition.posted_before,
            acquisition.reconciliation_start_date,
            acquisition.reconciliation_end_date,
            list(acquisition.marketplace_ids),
            Jsonb(payload["api_metadata"]),
            Jsonb(payload["documents"]),
        ),
    )


def _persist_transactions(
    cursor: Cursor[dict[str, Any]],
    acquisition: FinancesAcquisition,
    transactions: Sequence[FinancesTransaction],
    accepted: Sequence[Mapping[str, Any]],
    batch_id: str,
) -> bool:
    if not transactions:
        return False
    identities = _ensure_transaction_identities(cursor, acquisition, transactions, accepted)
    cursor.execute(
        "SELECT id,unit_id,content_sha256 FROM private.source_unit_versions "
        "WHERE unit_id=ANY(%s::uuid[])",
        ([identities[row.native_transaction_id] for row in transactions],),
    )
    revisions = {
        (str(row["unit_id"]), row["content_sha256"]): str(row["id"]) for row in cursor.fetchall()
    }
    new_versions: list[tuple[object, ...]] = []
    new_revisions: list[tuple[object, ...]] = []
    new_components: list[tuple[object, ...]] = []
    memberships: list[tuple[object, ...]] = []
    current = {row["native_transaction_id"]: str(row["current_version_id"]) for row in accepted}
    changed = False
    for row in transactions:
        identity = identities[row.native_transaction_id]
        digest = revision_digest(row)
        revision = revisions.get((identity, digest))
        if revision is None:
            revision = str(uuid7())
            new_versions.append((revision, identity, "FINANCES", digest, len(row.components)))
            new_revisions.append(_revision_row(row, revision))
            new_components.extend(
                _component_row(component, revision) for component in row.components
            )
        changed |= current.get(row.native_transaction_id) != revision
        memberships.append(
            (batch_id, identity, revision, row.source_page_number, row.source_record_number)
        )
    copy_rows(
        cursor,
        "COPY private.source_unit_versions (id,unit_id,source,content_sha256,row_count) FROM STDIN",
        new_versions,
    )
    copy_rows(
        cursor,
        "COPY private.finances_transactions "
        "(version_id,posted_date,posted_at,marketplace_id,marketplace_name,"
        "account_type,transaction_type,transaction_status,deferred_transaction_id,release_transaction_id,"
        "is_activity,total_amount,currency,amount_count,customer_order_id) FROM STDIN",
        new_revisions,
    )
    copy_rows(
        cursor,
        "COPY private.finances_amounts "
        "(id,version_id,amount_number,amount_type,selbox_group,sku,amount,"
        "quantity,fee_base,breakdown_path,item_index,breakdown_indexes,route,amount_part,asin,fnsku,"
        "reference_id,covered_month,ledger_first_month,ledger_last_month) FROM STDIN",
        new_components,
    )
    copy_rows(
        cursor,
        "COPY private.source_batch_units "
        "(batch_id,unit_id,version_id,document_number,record_number) FROM STDIN",
        memberships,
    )
    cursor.execute(
        "UPDATE private.source_units t SET "
        "current_version_id=m.version_id,current_batch_id=m.batch_id "
        "FROM private.source_batch_units m "
        "WHERE m.batch_id=%s AND t.id=m.unit_id",
        (batch_id,),
    )
    return changed


def _ensure_transaction_identities(
    cursor: Cursor[dict[str, Any]],
    acquisition: FinancesAcquisition,
    transactions: Sequence[FinancesTransaction],
    accepted: Sequence[Mapping[str, Any]],
) -> dict[str, str]:
    identities = {str(row["native_transaction_id"]): str(row["id"]) for row in accepted}
    new_identities: list[tuple[str, str, str, str, str]] = []
    for row in transactions:
        if row.native_transaction_id not in identities:
            identity = str(uuid7())
            identities[row.native_transaction_id] = identity
            new_identities.append(
                (
                    identity,
                    "FINANCES",
                    acquisition.seller_namespace,
                    acquisition.amazon_scope,
                    row.native_transaction_id,
                )
            )
    copy_rows(
        cursor,
        "COPY private.source_units (id,source,seller_namespace,amazon_scope,unit_key) FROM STDIN",
        new_identities,
    )
    return identities


def _revision_row(row: FinancesTransaction, revision: str) -> tuple[object, ...]:
    return (
        revision,
        row.posted_date,
        row.posted_at,
        row.marketplace_id,
        row.marketplace_name,
        row.account_type,
        row.transaction_type,
        row.transaction_status,
        row.deferred_transaction_id,
        row.release_transaction_id,
        row.activity_eligible,
        row.total_amount.value,
        row.currency,
        len(row.components),
        row.order_id,
    )


def _component_row(component: FinancesComponent, revision: str) -> tuple[object, ...]:
    return (
        str(uuid7()),
        revision,
        component.component_number,
        component.component_type,
        component.accounting_subtype,
        component.sku,
        component.amount.value,
        None if component.quantity is None else component.quantity.value,
        None if component.fee_base is None else component.fee_base.value,
        list(component.breakdown_path),
        component.item_index,
        list(component.breakdown_indexes),
        component.route,
        component.amount_part,
        component.asin,
        component.fnsku,
        component.reference_id,
        component.reference_month,
        component.ledger_start_month,
        component.ledger_end_month,
    )
