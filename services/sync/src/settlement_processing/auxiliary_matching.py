"""Match each normalized auxiliary observation to at most one Settlement group."""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

from ..frozen_values import freeze_mapping
from .auxiliary_policy import (
    REMOVAL_CATEGORIES,
    compatible_observation_categories,
)
from .models import AuxiliaryFeeObservation, JoinMethod
from .non_direct_grouping import NonDirectGroupDraft


@dataclass(frozen=True)
class MatchedAuxiliaryObservation:
    observation: AuxiliaryFeeObservation
    join_method: JoinMethod


@dataclass(frozen=True)
class AuxiliaryObservationMatches:
    by_group_id: Mapping[str, tuple[MatchedAuxiliaryObservation, ...]]
    ambiguous_group_ids: frozenset[str]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "by_group_id",
            freeze_mapping(self.by_group_id, field_name="by_group_id"),
        )


def _scope_match(
    draft: NonDirectGroupDraft,
    observation: AuxiliaryFeeObservation,
    report_first_date: date,
    report_end_date_exclusive: date,
) -> bool:
    period_matches = (
        observation.source_start_date < report_end_date_exclusive
        and observation.source_end_date >= report_first_date
    )
    is_removal_observation = observation.category_code in REMOVAL_CATEGORIES
    removal_reference_matches = not is_removal_observation or (
        draft.category_code in REMOVAL_CATEGORIES
        and observation.removal_order_id is not None
        and observation.removal_order_id == draft.amazon_adjustment_id
    )
    marketplace_matches = (
        observation.marketplace_id == draft.marketplace_id
        if draft.marketplace_id is not None
        else draft.marketplace_name is None
    )
    return (
        observation.source_system == draft.preferred_auxiliary_source
        and observation.category_code in compatible_observation_categories(draft.category_code)
        and observation.currency == draft.currency
        and (period_matches or is_removal_observation)
        and removal_reference_matches
        and marketplace_matches
    )


def _observation_sort_key(observation: AuxiliaryFeeObservation) -> tuple[object, ...]:
    return (
        observation.source_system,
        observation.source_start_date,
        observation.source_end_date,
        observation.marketplace_id,
        observation.category_code,
        observation.amz_sku,
        observation.currency,
        observation.removal_order_id or "",
        observation.reported_amount,
        observation.normalized_amount,
        (observation.quantity is None, observation.quantity),
    )


def match_auxiliary_observations(
    drafts: Sequence[NonDirectGroupDraft],
    observations: Sequence[AuxiliaryFeeObservation],
    report_first_date: date,
    report_end_date_exclusive: date,
) -> AuxiliaryObservationMatches:
    """Use only each group's configured source, without cross-source fallback."""
    matches: defaultdict[str, list[MatchedAuxiliaryObservation]] = defaultdict(list)
    ambiguous_group_ids: set[str] = set()
    for observation in sorted(observations, key=_observation_sort_key):
        candidates = [
            draft
            for draft in drafts
            if _scope_match(draft, observation, report_first_date, report_end_date_exclusive)
        ]
        if observation.category_code in REMOVAL_CATEGORIES:
            if observation.removal_order_id is None:
                raise ValueError("Removal observations require an exact removal_order_id.")
            join_method: JoinMethod = "EXACT_KEY"
        else:
            join_method = "AGGREGATE_ALLOCATION"

        if len(candidates) == 1:
            matches[candidates[0].id].append(MatchedAuxiliaryObservation(observation, join_method))
        elif len(candidates) > 1:
            ambiguous_group_ids.update(draft.id for draft in candidates)

    return AuxiliaryObservationMatches(
        by_group_id={key: tuple(value) for key, value in matches.items()},
        ambiguous_group_ids=frozenset(ambiguous_group_ids),
    )


__all__ = [
    "AuxiliaryObservationMatches",
    "MatchedAuxiliaryObservation",
    "match_auxiliary_observations",
]
