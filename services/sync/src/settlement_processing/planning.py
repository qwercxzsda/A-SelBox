"""Build in-memory Settlement-grounded allocation plans."""

from collections.abc import Callable, Sequence
from datetime import date

from .auxiliary_planning import build_non_direct_groups
from .classification import classify_ledger_entries, index_company_sku_fee_rate_candidates
from .direct_planning import build_direct_groups, is_direct_entry
from .models import (
    AllocationGroupPlan,
    AuxiliaryFeeObservation,
    CategoryMappingRule,
    ClassifiedEntry,
    CompanySkuFeeRateCandidate,
    LedgerEntry,
)


def _partition_classified_entries(
    ledger_entries: Sequence[LedgerEntry],
    rules: Sequence[CategoryMappingRule],
) -> tuple[list[ClassifiedEntry], list[ClassifiedEntry]]:
    direct: list[ClassifiedEntry] = []
    non_direct: list[ClassifiedEntry] = []
    for classified in classify_ledger_entries(ledger_entries, rules):
        (direct if is_direct_entry(classified) else non_direct).append(classified)
    return direct, non_direct


def _validate_report_window(
    ledger_entries: Sequence[LedgerEntry],
    first_date: date,
    end_date_exclusive: date,
) -> None:
    if not ledger_entries:
        raise ValueError("Settlement elaboration requires at least one ledger entry.")
    if first_date >= end_date_exclusive:
        raise ValueError("Settlement report date window must be non-empty.")


def build_allocation_groups(
    ledger_entries: Sequence[LedgerEntry],
    rules: Sequence[CategoryMappingRule],
    fee_rate_candidates: Sequence[CompanySkuFeeRateCandidate],
    auxiliary_observations: Sequence[AuxiliaryFeeObservation],
    first_date: date,
    end_date_exclusive: date,
    id_factory: Callable[[], str],
) -> tuple[AllocationGroupPlan, ...]:
    """Build the canonical group/target graph used for scope and persistence."""
    _validate_report_window(ledger_entries, first_date, end_date_exclusive)
    direct, non_direct = _partition_classified_entries(ledger_entries, rules)
    fee_rates_by_key = index_company_sku_fee_rate_candidates(fee_rate_candidates)
    groups = build_direct_groups(direct, fee_rates_by_key, id_factory)
    groups.extend(
        build_non_direct_groups(
            non_direct,
            auxiliary_observations,
            fee_rates_by_key,
            first_date,
            end_date_exclusive,
            id_factory,
        )
    )
    return tuple(groups)


__all__ = ["build_allocation_groups"]
