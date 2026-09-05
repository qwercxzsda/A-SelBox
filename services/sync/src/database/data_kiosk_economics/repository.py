"""Atomic provision process persistence and explicit result retention."""

import logging
from collections.abc import Sequence
from typing import Protocol
from uuid import uuid4

from ...amazon.scopes import validate_amazon_scope
from ..company_sku_fee_rates import (
    CompanySkuFeeRate,
    CompanySkuFeeRateResolver,
    UnassignedSelboxFeeError,
    load_company_sku_fee_rates,
)
from ..connection import DatabaseConnection
from ..seller_namespaces import validate_seller_namespace
from .models import (
    PROCESSOR_VERSION,
    DataKioskProvisionPersistenceResult,
    DataKioskProvisionRefresh,
)
from .parameters import provision_parameters
from .queries import (
    INSERT_DATA_KIOSK_PROVISION_PROCESSING_LOG_SQL,
    INSERT_DATA_KIOSK_PROVISION_SQL,
    PRUNE_DATA_KIOSK_PROVISION_RESULTS_SQL,
)

PROVISION_INSERT_BATCH_SIZE = 1000
_LOGGER = logging.getLogger(__name__)


class ProvisionCursor(Protocol):
    """Cursor operations used by provision process persistence."""

    def execute(self, query: str, parameters: dict[str, object], /) -> object: ...

    def executemany(
        self,
        query: str,
        parameters: Sequence[dict[str, object]],
        /,
    ) -> object: ...

    def fetchall(self) -> Sequence[Sequence[object]]: ...


def persist_data_kiosk_provisions(
    database: DatabaseConnection,
    refresh: DataKioskProvisionRefresh,
) -> DataKioskProvisionPersistenceResult:
    """Append one process log and all selected results in one short transaction."""
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor() as cursor,
    ):
        return persist_data_kiosk_provisions_with_cursor(cursor, refresh)


def persist_data_kiosk_provisions_with_cursor(
    cursor: ProvisionCursor,
    refresh: DataKioskProvisionRefresh,
) -> DataKioskProvisionPersistenceResult:
    """Append provisions with a caller-owned transaction cursor."""
    processing_log_id = str(uuid4())
    resolver = CompanySkuFeeRateResolver(_load_fee_rates(cursor, refresh))
    provision_rows: list[dict[str, object]] = []
    for fact in sorted(refresh.facts, key=lambda value: value.natural_key):
        fee_rate = resolver.resolve(fact.marketplace_id, fact.msku, fact.start_date)
        if fee_rate is None:
            _LOGGER.error(
                "Missing Selbox fee assignment; provision processing aborted. "
                "processing_log_id=%s seller_namespace=%s marketplace_id=%s "
                "sku=%s activity_date=%s",
                processing_log_id,
                refresh.seller_namespace,
                fact.marketplace_id,
                fact.msku,
                fact.start_date,
            )
            raise UnassignedSelboxFeeError("Provision processing has an unassigned SKU fee.")
        provision_rows.append(
            provision_parameters(refresh, fact, fee_rate, processing_log_id=processing_log_id)
        )
    cursor.execute(
        INSERT_DATA_KIOSK_PROVISION_PROCESSING_LOG_SQL,
        {
            "id": processing_log_id,
            "seller_namespace": refresh.seller_namespace,
            "amazon_scope": refresh.amazon_scope,
            "marketplace_ids": sorted(refresh.marketplace_ids),
            "processor_version": PROCESSOR_VERSION,
            "provision_row_count": len(provision_rows),
        },
    )
    for offset in range(0, len(provision_rows), PROVISION_INSERT_BATCH_SIZE):
        cursor.executemany(
            INSERT_DATA_KIOSK_PROVISION_SQL,
            provision_rows[offset : offset + PROVISION_INSERT_BATCH_SIZE],
        )
    return DataKioskProvisionPersistenceResult(
        processing_log_id=processing_log_id,
        refreshed_marketplace_count=len(refresh.marketplace_ids),
        provision_row_count=len(provision_rows),
    )


def prune_data_kiosk_provision_results(
    database: DatabaseConnection,
    *,
    seller_namespace: str,
    amazon_scope: str,
    keep_latest: int,
) -> int:
    """Delete results older than the latest k processes per marketplace; keep logs."""
    seller_namespace = validate_seller_namespace(seller_namespace)
    amazon_scope = validate_amazon_scope(amazon_scope)
    if type(keep_latest) is not int or keep_latest < 1:
        raise ValueError("keep_latest must be a positive integer.")
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor() as cursor,
    ):
        cursor.execute(
            PRUNE_DATA_KIOSK_PROVISION_RESULTS_SQL,
            {
                "seller_namespace": seller_namespace,
                "amazon_scope": amazon_scope,
                "keep_latest": keep_latest,
            },
        )
        row = cursor.fetchone()
        if row is None or type(row[0]) is not int or row[0] < 0:
            raise RuntimeError("Provision result pruning did not return a valid row count.")
        return row[0]


def _load_fee_rates(
    cursor: ProvisionCursor,
    refresh: DataKioskProvisionRefresh,
) -> tuple[CompanySkuFeeRate, ...]:
    if not refresh.facts:
        return ()
    activity_dates = tuple(fact.start_date for fact in refresh.facts)
    return load_company_sku_fee_rates(
        cursor,
        seller_namespace=refresh.seller_namespace,
        marketplace_skus=tuple((fact.marketplace_id, fact.msku) for fact in refresh.facts),
        activity_date_from=min(activity_dates),
        activity_date_to=max(activity_dates),
    )


__all__ = [
    "PROVISION_INSERT_BATCH_SIZE",
    "ProvisionCursor",
    "persist_data_kiosk_provisions",
    "persist_data_kiosk_provisions_with_cursor",
    "prune_data_kiosk_provision_results",
]
