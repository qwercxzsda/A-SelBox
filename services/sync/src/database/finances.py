"""Atomically accept validated transaction revisions and complete observation memberships."""

from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any, LiteralString
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
        scope_expanded = _scope_expanded(cursor, acquisition, candidate)
        _persist_acquisition(cursor, acquisition)
        cursor.execute(
            "INSERT INTO private.finances_preprocess_batches "
            "(id,acquisition_id,preprocess_version,transaction_count,component_count) "
            "VALUES (%s,%s,%s,%s,%s)",
            (
                batch_id,
                str(acquisition.id),
                preprocess_version,
                len(candidate.transactions),
                sum(len(row.components) for row in candidate.transactions),
            ),
        )
        _persist_transactions(cursor, acquisition, candidate.transactions, accepted, batch_id)
        months = {acquisition.query_start_date.replace(day=1)}
        incoming_ids = {row.native_transaction_id for row in candidate.transactions}
        months.update(
            row["posted_date"].replace(day=1)
            for row in accepted
            if row["native_transaction_id"] in incoming_ids
        )
        _request_refresh(cursor, months, scope_expanded)
    return batch_id


def _current_transactions(
    cursor: Cursor[dict[str, Any]], acquisition: FinancesAcquisition
) -> list[dict[str, Any]]:
    cursor.execute(
        "SELECT t.id,t.native_transaction_id,t.current_version_id,t.current_batch_id,"
        "v.posted_date,v.posted_at,v.marketplace_id,v.marketplace_name,v.account_type,"
        "v.transaction_type,v.transaction_status,v.deferred_transaction_id,v.release_transaction_id,"
        "v.activity_eligible,v.total_amount,v.currency,a.id AS acquisition_id,a.capture_started_at "
        "FROM private.finances_transactions t "
        "JOIN private.finances_transaction_versions v ON v.id=t.current_version_id "
        "JOIN private.finances_preprocess_batches r ON r.id=t.current_batch_id "
        "JOIN private.finances_acquisitions a ON a.id=r.acquisition_id "
        "WHERE t.seller_namespace=%s AND t.amazon_scope=%s",
        (acquisition.seller_namespace, acquisition.amazon_scope),
    )
    return cursor.fetchall()


def _overlapping_observations(
    cursor: Cursor[dict[str, Any]], acquisition: FinancesAcquisition
) -> list[dict[str, Any]]:
    cursor.execute(
        "SELECT a.id,a.capture_started_at FROM private.finances_acquisitions a "
        "WHERE a.seller_namespace=%s AND a.amazon_scope=%s "
        "AND a.query_start_date<=%s AND a.query_end_date>=%s "
        "AND a.marketplace_ids && %s::text[] "
        "AND EXISTS(SELECT 1 FROM private.finances_preprocess_batches r WHERE "
        "r.acquisition_id=a.id)",
        (
            acquisition.seller_namespace,
            acquisition.amazon_scope,
            acquisition.query_end_date,
            acquisition.query_start_date,
            list(acquisition.marketplace_ids),
        ),
    )
    return cursor.fetchall()


def _persist_acquisition(cursor: Cursor[dict[str, Any]], acquisition: FinancesAcquisition) -> None:
    cursor.execute(
        "SELECT * FROM private.finances_acquisitions WHERE id=%s", (str(acquisition.id),)
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
        "INSERT INTO private.finances_acquisitions "
        "(id,seller_namespace,amazon_scope,api_version,capture_started_at,downloaded_at,"
        "query_start_date,query_end_date,marketplace_ids,api_metadata,documents) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            str(acquisition.id),
            acquisition.seller_namespace,
            acquisition.amazon_scope,
            acquisition.api_version,
            acquisition.capture_started_at,
            acquisition.downloaded_at,
            acquisition.query_start_date,
            acquisition.query_end_date,
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
) -> None:
    if not transactions:
        return
    identities = _ensure_transaction_identities(cursor, acquisition, transactions, accepted)
    cursor.execute(
        "SELECT id,transaction_id,content_sha256 FROM private.finances_transaction_versions "
        "WHERE transaction_id=ANY(%s::uuid[])",
        ([identities[row.native_transaction_id] for row in transactions],),
    )
    revisions = {
        (str(row["transaction_id"]), row["content_sha256"]): str(row["id"])
        for row in cursor.fetchall()
    }
    new_revisions: list[tuple[object, ...]] = []
    new_components: list[tuple[object, ...]] = []
    memberships: list[tuple[object, ...]] = []
    for row in transactions:
        identity = identities[row.native_transaction_id]
        digest = revision_digest(row)
        revision = revisions.get((identity, digest))
        if revision is None:
            revision = str(uuid7())
            new_revisions.append(_revision_row(row, identity, revision, digest))
            new_components.extend(
                _component_row(component, revision) for component in row.components
            )
        memberships.append(
            (batch_id, identity, revision, row.source_page_number, row.source_record_number)
        )
    _copy_rows(
        cursor,
        "COPY private.finances_transaction_versions "
        "(id,transaction_id,content_sha256,posted_date,posted_at,marketplace_id,marketplace_name,"
        "account_type,transaction_type,transaction_status,deferred_transaction_id,release_transaction_id,"
        "activity_eligible,total_amount,currency,component_count) FROM STDIN",
        new_revisions,
    )
    _copy_rows(
        cursor,
        "COPY private.finances_transaction_components "
        "(id,version_id,component_number,category,component_type,accounting_subtype,sku,amount,"
        "quantity,fee_base,breakdown_path,item_index,breakdown_indexes) FROM STDIN",
        new_components,
    )
    _copy_rows(
        cursor,
        "COPY private.finances_preprocess_batch_transactions "
        "(batch_id,transaction_id,version_id,source_page_number,source_record_number) FROM STDIN",
        memberships,
    )
    cursor.execute(
        "UPDATE private.finances_transactions t SET "
        "current_version_id=m.version_id,current_batch_id=m.batch_id "
        "FROM private.finances_preprocess_batch_transactions m "
        "WHERE m.batch_id=%s AND t.id=m.transaction_id",
        (batch_id,),
    )


def _ensure_transaction_identities(
    cursor: Cursor[dict[str, Any]],
    acquisition: FinancesAcquisition,
    transactions: Sequence[FinancesTransaction],
    accepted: Sequence[Mapping[str, Any]],
) -> dict[str, str]:
    identities = {str(row["native_transaction_id"]): str(row["id"]) for row in accepted}
    new_identities: list[tuple[str, str, str, str]] = []
    for row in transactions:
        if row.native_transaction_id not in identities:
            identity = str(uuid7())
            identities[row.native_transaction_id] = identity
            new_identities.append(
                (
                    identity,
                    acquisition.seller_namespace,
                    acquisition.amazon_scope,
                    row.native_transaction_id,
                )
            )
    _copy_rows(
        cursor,
        "COPY private.finances_transactions "
        "(id,seller_namespace,amazon_scope,native_transaction_id) FROM STDIN",
        new_identities,
    )
    return identities


def _revision_row(
    row: FinancesTransaction, identity: str, revision: str, digest: str
) -> tuple[object, ...]:
    return (
        revision,
        identity,
        digest,
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
    )


def _component_row(component: FinancesComponent, revision: str) -> tuple[object, ...]:
    return (
        str(uuid7()),
        revision,
        component.component_number,
        component.category.value,
        component.component_type,
        component.accounting_subtype,
        component.sku,
        component.amount.value,
        None if component.quantity is None else component.quantity.value,
        None if component.fee_base is None else component.fee_base.value,
        list(component.breakdown_path),
        component.item_index,
        list(component.breakdown_indexes),
    )


def _copy_rows(
    cursor: Cursor[dict[str, Any]], statement: LiteralString, rows: Sequence[Sequence[object]]
) -> None:
    """One client-side COPY statement makes complete-inventory triggers linear."""
    if rows:
        with cursor.copy(statement) as copy:
            for row in rows:
                copy.write_row(row)


def _scope_expanded(
    cursor: Cursor[dict[str, Any]], acquisition: FinancesAcquisition, prepared: PreparedFinances
) -> bool:
    """New seller/SKU history or complete marketplace coverage affects older reports."""
    skus = sorted(
        {
            component.sku
            for transaction in prepared.transactions
            if transaction.activity_eligible
            for component in transaction.components
            if component.sku is not None
        }
    )
    cursor.execute(
        "SELECT private.payout_source_has_new_skus(%s,%s::text[]) AS new_skus,"
        "EXISTS(SELECT 1 FROM unnest(%s::text[]) AS requested(marketplace_id) "
        "WHERE NOT EXISTS(SELECT 1 FROM private.finances_acquisitions a "
        "WHERE a.seller_namespace=%s AND a.amazon_scope=%s "
        "AND requested.marketplace_id=ANY(a.marketplace_ids) "
        "AND EXISTS(SELECT 1 FROM private.finances_preprocess_batches b "
        "WHERE b.acquisition_id=a.id))) AS new_marketplace",
        (
            acquisition.seller_namespace,
            skus,
            list(acquisition.marketplace_ids),
            acquisition.seller_namespace,
            acquisition.amazon_scope,
        ),
    )
    row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Finances scope comparison returned no result.")
    return bool(row["new_skus"] or row["new_marketplace"])


def _request_refresh(
    cursor: Cursor[dict[str, Any]], months: set[date], scope_expanded: bool
) -> None:
    cursor.execute("SELECT private.request_payout_report_refresh(%s::date[])", (sorted(months),))
    if scope_expanded:
        cursor.execute("SELECT private.request_all_payout_report_refreshes()")
