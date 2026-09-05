"""Allocate account-level entries using transient auxiliary evidence."""

from collections import defaultdict
from collections.abc import Callable, Sequence
from datetime import date

from ..numeric import ZERO, Numeric
from .auxiliary_matching import (
    AuxiliaryObservationMatches,
    MatchedAuxiliaryObservation,
    match_auxiliary_observations,
)
from .auxiliary_policy import REMOVAL_CATEGORIES
from .classification import CompanySkuFeeRateCandidateIndex, resolve_company_for_interval
from .models import (
    AllocationGroupPlan,
    AllocationTargetPlan,
    AuxiliaryFeeObservation,
    ClassifiedEntry,
    CompanyResolution,
    JoinMethod,
    UnassignedReason,
)
from .non_direct_grouping import NonDirectGroupDraft, build_non_direct_group_drafts
from .quantities import settlement_metric_quantity, sum_known_quantities

type AuxiliaryTargetKey = tuple[str, str, date, date]


def _representative_date(
    draft: NonDirectGroupDraft,
    matched: Sequence[MatchedAuxiliaryObservation],
) -> date:
    """Use the evidenced removal request date, retaining source postings separately."""
    if draft.category_code not in REMOVAL_CATEGORIES or not matched:
        return draft.latest_posted_date
    request_intervals = {
        (item.observation.source_start_date, item.observation.source_end_date) for item in matched
    }
    if len(request_intervals) != 1:
        raise ValueError("Matched removal observations must agree on one request date.")
    request_start, request_end = next(iter(request_intervals))
    if request_start != request_end:
        raise ValueError("Matched removal observations must have a single-day request date.")
    return request_start


def _target_join_method(
    matched: Sequence[MatchedAuxiliaryObservation],
) -> JoinMethod:
    return (
        "EXACT_KEY"
        if all(item.join_method == "EXACT_KEY" for item in matched)
        else "AGGREGATE_ALLOCATION"
    )


def _build_auxiliary_target(
    draft: NonDirectGroupDraft,
    matched: Sequence[MatchedAuxiliaryObservation],
    company: CompanyResolution | None,
    id_factory: Callable[[], str],
) -> AllocationTargetPlan:
    first = matched[0].observation
    amount = sum((item.observation.normalized_amount for item in matched), ZERO)
    quantity = sum_known_quantities(item.observation.quantity for item in matched)
    return AllocationTargetPlan(
        id=id_factory(),
        allocation_group_id=draft.id,
        company_id=company.company_id if company else None,
        company_sku_fee_rate_id=(company.company_sku_fee_rate_id if company else None),
        fee_rate_percent=company.fee_rate_percent if company else None,
        marketplace_id=first.marketplace_id,
        amz_sku=first.amz_sku,
        join_method=_target_join_method(matched),
        unassigned_reason=None if company else "MISSING_COMPANY_ASSIGNMENT",
        settlement_amount=amount,
        elaborated_amount=amount,
        selbox_fee_base=ZERO,
        selbox_fee=ZERO,
        settlement_quantity=quantity,
        elaborated_quantity=quantity,
        company_payable_quantity=quantity,
        activity_start_date=first.source_start_date,
        activity_end_date=first.source_end_date,
    )


def _residual_reason(
    draft: NonDirectGroupDraft,
    has_auxiliary_targets: bool,
    has_ambiguous_observations: bool,
) -> UnassignedReason:
    if draft.pnl_treatment == "EXCLUDED":
        return "EXCLUDED_MOVEMENT"
    if draft.pnl_treatment == "ACCOUNT_EXPENSE":
        return "ACCOUNT_LEVEL_EXPENSE"
    if draft.preferred_auxiliary_source is None:
        return "NO_AUXILIARY_SOURCE"
    if has_ambiguous_observations:
        return "AMBIGUOUS_AUXILIARY_MATCH"
    if not has_auxiliary_targets:
        return "NO_MATCHING_AUXILIARY_OBSERVATION"
    return "SETTLEMENT_RESIDUAL"


def _build_residual_target(
    draft: NonDirectGroupDraft,
    representative_date: date,
    residual_amount: Numeric,
    has_auxiliary_targets: bool,
    has_ambiguous_observations: bool,
    id_factory: Callable[[], str],
) -> AllocationTargetPlan:
    quantity = (
        None
        if has_auxiliary_targets
        else settlement_metric_quantity([item.ledger_entry for item in draft.classified_entries])
    )
    return AllocationTargetPlan(
        id=id_factory(),
        allocation_group_id=draft.id,
        company_id=None,
        company_sku_fee_rate_id=None,
        fee_rate_percent=None,
        marketplace_id=draft.marketplace_id,
        amz_sku=None,
        join_method="UNATTRIBUTED",
        unassigned_reason=_residual_reason(
            draft,
            has_auxiliary_targets,
            has_ambiguous_observations,
        ),
        settlement_amount=residual_amount,
        elaborated_amount=ZERO,
        selbox_fee_base=ZERO,
        selbox_fee=ZERO,
        settlement_quantity=quantity,
        difference_quantity=quantity,
        company_payable_quantity=quantity,
        activity_start_date=representative_date,
        activity_end_date=representative_date,
    )


def _build_targets(
    draft: NonDirectGroupDraft,
    matched: Sequence[MatchedAuxiliaryObservation],
    representative_date: date,
    has_ambiguous_observations: bool,
    fee_rates_by_key: CompanySkuFeeRateCandidateIndex,
    id_factory: Callable[[], str],
) -> tuple[AllocationTargetPlan, ...]:
    buckets: defaultdict[AuxiliaryTargetKey, list[MatchedAuxiliaryObservation]] = defaultdict(list)
    for item in matched:
        observation = item.observation
        key: AuxiliaryTargetKey = (
            observation.marketplace_id,
            observation.amz_sku,
            observation.source_start_date,
            observation.source_end_date,
        )
        buckets[key].append(item)
    auxiliary_targets = [
        _build_auxiliary_target(
            draft,
            buckets[key],
            resolve_company_for_interval(*key, fee_rates_by_key),
            id_factory,
        )
        for key in sorted(buckets)
    ]
    observed_total = sum((target.settlement_amount for target in auxiliary_targets), ZERO)
    residual_amount = draft.settlement_amount - observed_total
    if residual_amount != ZERO or not auxiliary_targets:
        auxiliary_targets.append(
            _build_residual_target(
                draft,
                representative_date,
                residual_amount,
                bool(auxiliary_targets),
                has_ambiguous_observations,
                id_factory,
            )
        )
    return tuple(auxiliary_targets)


def _materialize_group(
    draft: NonDirectGroupDraft,
    matches: AuxiliaryObservationMatches,
    fee_rates_by_key: CompanySkuFeeRateCandidateIndex,
    id_factory: Callable[[], str],
) -> AllocationGroupPlan:
    matched = matches.by_group_id.get(draft.id, ())
    representative_date = _representative_date(draft, matched)
    targets = _build_targets(
        draft,
        matched,
        representative_date,
        draft.id in matches.ambiguous_group_ids,
        fee_rates_by_key,
        id_factory,
    )
    return AllocationGroupPlan(
        id=draft.id,
        category_code=draft.category_code,
        handling_method=draft.handling_method,
        pnl_treatment=draft.pnl_treatment,
        amazon_order_id=draft.amazon_order_id,
        amazon_adjustment_id=draft.amazon_adjustment_id,
        amazon_shipment_id=draft.amazon_shipment_id,
        representative_date=representative_date,
        marketplace_id=draft.marketplace_id,
        marketplace_name=draft.marketplace_name,
        currency=draft.currency,
        settlement_amount=draft.settlement_amount,
        ledger_entry_ids=draft.ledger_entry_ids,
        targets=targets,
    )


def build_non_direct_groups(
    classified_entries: Sequence[ClassifiedEntry],
    auxiliary_observations: Sequence[AuxiliaryFeeObservation],
    fee_rates_by_key: CompanySkuFeeRateCandidateIndex,
    report_first_date: date,
    report_end_date_exclusive: date,
    id_factory: Callable[[], str],
) -> list[AllocationGroupPlan]:
    """Resolve MSKU evidence and put every mismatch in a residual target."""
    drafts = build_non_direct_group_drafts(classified_entries, id_factory)
    matches = match_auxiliary_observations(
        drafts,
        auxiliary_observations,
        report_first_date,
        report_end_date_exclusive,
    )
    return [_materialize_group(draft, matches, fee_rates_by_key, id_factory) for draft in drafts]


__all__ = ["build_non_direct_groups"]
