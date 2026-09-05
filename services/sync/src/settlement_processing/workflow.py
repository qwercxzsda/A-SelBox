"""Orchestrate one complete, repeatable Settlement processing run."""

import logging
from collections.abc import Callable, Sequence
from pathlib import Path
from uuid import uuid4

from ..database.company_sku_fee_rates import (
    CompanySkuFeeRate,
    UnassignedSelboxFeeError,
    load_company_sku_fee_rates,
)
from ..database.connection import DatabaseConnection
from ..database.settlement_report_selection_repository import select_settlement_report_id
from .artifacts import ProcessingArtifactLog
from .models import (
    PROCESSOR_VERSION,
    AuxiliaryFeeObservation,
    AuxiliaryRequirements,
    CompanySkuFeeRateCandidate,
    PreparedSettlement,
    SettlementProcessingPlan,
    SettlementProcessingResult,
)
from .planning import build_allocation_groups
from .policy import SETTLEMENT_CATEGORY_RULES
from .raw_report import prepare_settlement_report
from .repository import load_settlement_report, persist_settlement_processing
from .requirements import derive_auxiliary_requirements

_LOGGER = logging.getLogger(__name__)

type AuxiliaryLoader = Callable[
    [PreparedSettlement, AuxiliaryRequirements, ProcessingArtifactLog],
    Sequence[AuxiliaryFeeObservation],
]


def process_settlement_report(
    database: DatabaseConnection,
    auxiliary_loader: AuxiliaryLoader,
    *,
    seller_namespace: str,
    artifact_root: Path,
    settlement_report_id: str | None = None,
    processor_version: str = PROCESSOR_VERSION,
    id_factory: Callable[[], str] = lambda: str(uuid4()),
) -> SettlementProcessingResult:
    """Process an explicit report or the oldest report with no successful run."""
    selected_id = select_settlement_report_id(
        database,
        seller_namespace=seller_namespace,
        settlement_report_id=settlement_report_id,
    )
    if selected_id is None:
        return SettlementProcessingResult(
            settlement_report_id=None,
            processing_log_id=None,
            no_unprocessed_report=True,
        )

    prepared = prepare_settlement_report(
        load_settlement_report(database, selected_id),
        id_factory=id_factory,
    )
    processing_log_id = id_factory()
    artifacts = ProcessingArtifactLog.create(artifact_root, processing_log_id)
    requirements = derive_auxiliary_requirements(prepared.ledger_entries)
    auxiliary_observations = tuple(auxiliary_loader(prepared, requirements, artifacts))
    fee_rates = _load_fee_rates(database, prepared, auxiliary_observations)
    artifacts.write_json(
        Path("company-sku-fee-rates.json"),
        [_fee_rate_artifact(row) for row in fee_rates],
    )
    groups = build_allocation_groups(
        prepared.ledger_entries,
        SETTLEMENT_CATEGORY_RULES,
        tuple(_fee_rate_candidate(row) for row in fee_rates),
        auxiliary_observations,
        prepared.transaction_start_date,
        prepared.transaction_end_date_exclusive,
        id_factory,
    )
    plan = SettlementProcessingPlan(
        processing_log_id=processing_log_id,
        processor_version=processor_version,
        settlement=prepared,
        groups=groups,
    )
    _validate_fee_assignments(plan)
    persist_settlement_processing(database, plan)
    result_count = sum(len(group.targets) for group in groups)
    return SettlementProcessingResult(
        settlement_report_id=selected_id,
        processing_log_id=processing_log_id,
        processed_entry_count=len(prepared.ledger_entries),
        processed_result_count=result_count,
    )


def _validate_fee_assignments(plan: SettlementProcessingPlan) -> None:
    """Reject missing SKU fees while allowing account-level residual results."""
    missing_targets = (
        (group, target)
        for group in plan.groups
        for target in group.targets
        if target.unassigned_reason == "MISSING_COMPANY_ASSIGNMENT" and target.amz_sku is not None
    )
    for group, target in missing_targets:
        _LOGGER.error(
            "Missing Selbox fee assignment; Settlement processing aborted. "
            "settlement_report_id=%s processing_log_id=%s seller_namespace=%s "
            "marketplace_id=%s sku=%s activity_start_date=%s activity_end_date=%s",
            plan.settlement.report.id,
            plan.processing_log_id,
            plan.settlement.report.seller_namespace,
            target.marketplace_id or group.marketplace_id,
            target.amz_sku,
            target.activity_start_date,
            target.activity_end_date,
        )
        raise UnassignedSelboxFeeError("Settlement processing has an unassigned SKU fee.")


def _load_fee_rates(
    database: DatabaseConnection,
    settlement: PreparedSettlement,
    observations: Sequence[AuxiliaryFeeObservation],
) -> tuple[CompanySkuFeeRate, ...]:
    marketplace_skus = {
        (entry.marketplace_id, entry.amz_sku)
        for entry in settlement.ledger_entries
        if entry.marketplace_id is not None and entry.amz_sku is not None
    }
    marketplace_skus.update(
        (observation.marketplace_id, observation.amz_sku) for observation in observations
    )
    if not marketplace_skus:
        return ()
    activity_dates = [
        settlement.transaction_start_date,
        settlement.transaction_end_date_exclusive,
        *(observation.source_start_date for observation in observations),
        *(observation.source_end_date for observation in observations),
    ]
    with database.connection() as connection, connection.cursor() as cursor:
        return load_company_sku_fee_rates(
            cursor,
            seller_namespace=settlement.header.seller_namespace,
            marketplace_skus=tuple(sorted(marketplace_skus)),
            activity_date_from=min(activity_dates),
            activity_date_to=max(activity_dates),
        )


def _fee_rate_candidate(row: CompanySkuFeeRate) -> CompanySkuFeeRateCandidate:
    return CompanySkuFeeRateCandidate(
        company_sku_fee_rate_id=row.id,
        company_id=row.company_id,
        marketplace_id=row.marketplace_id,
        amz_sku=row.sku,
        valid_from=row.valid_from,
        valid_to=row.valid_to,
        fee_rate_percent=row.fee_rate_percent,
    )


def _fee_rate_artifact(row: CompanySkuFeeRate) -> dict[str, object]:
    return {
        "id": row.id,
        "company_id": row.company_id,
        "seller_namespace": row.seller_namespace,
        "marketplace_id": row.marketplace_id,
        "sku": row.sku,
        "fee_rate_percent": row.fee_rate_percent,
        "valid_from": row.valid_from,
        "valid_to": row.valid_to,
    }


__all__ = ["AuxiliaryLoader", "process_settlement_report"]
