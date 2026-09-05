"""Group Settlement entries that do not carry an authoritative SKU."""

from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date

from ..numeric import ZERO, Numeric
from .auxiliary_policy import REMOVAL_CATEGORIES
from .grouping_values import single_distinct_value, sortable_group_key
from .models import (
    AuxiliarySourceSystem,
    ClassifiedEntry,
    HandlingMethod,
    PnlTreatment,
)

type NonDirectGroupKey = tuple[
    str,
    str,
    PnlTreatment,
    HandlingMethod,
    AuxiliarySourceSystem | None,
    str | None,
    str | None,
    str | None,
    str | None,
    str | None,
]


@dataclass(frozen=True)
class NonDirectGroupDraft:
    id: str
    classified_entries: tuple[ClassifiedEntry, ...]
    category_code: str
    handling_method: HandlingMethod
    pnl_treatment: PnlTreatment
    preferred_auxiliary_source: AuxiliarySourceSystem | None
    amazon_order_id: str | None
    amazon_adjustment_id: str | None
    amazon_shipment_id: str | None
    latest_posted_date: date
    marketplace_id: str | None
    marketplace_name: str | None
    currency: str
    settlement_amount: Numeric
    ledger_entry_ids: tuple[str, ...]


def _group_key(item: ClassifiedEntry) -> NonDirectGroupKey:
    entry = item.ledger_entry
    preserve_removal_reference = item.category_code in REMOVAL_CATEGORIES
    preserve_secondary_references = (
        preserve_removal_reference and entry.amazon_adjustment_id is None
    )
    return (
        item.category_code,
        entry.currency,
        item.pnl_treatment,
        item.handling_method,
        item.preferred_auxiliary_source,
        entry.amazon_order_id if preserve_secondary_references else None,
        entry.amazon_adjustment_id if preserve_removal_reference else None,
        entry.amazon_shipment_id if preserve_secondary_references else None,
        entry.marketplace_id,
        entry.marketplace_name if entry.marketplace_id is None else None,
    )


def _build_draft(
    classified_entries: Sequence[ClassifiedEntry],
    id_factory: Callable[[], str],
) -> NonDirectGroupDraft:
    entries = [item.ledger_entry for item in classified_entries]
    first_classification = classified_entries[0]
    first = entries[0]
    settlement_amount = sum((entry.settlement_amount for entry in entries), ZERO)
    preserve_removal_reference = first_classification.category_code in REMOVAL_CATEGORIES
    return NonDirectGroupDraft(
        id=id_factory(),
        classified_entries=tuple(classified_entries),
        category_code=first_classification.category_code,
        handling_method=first_classification.handling_method,
        pnl_treatment=first_classification.pnl_treatment,
        preferred_auxiliary_source=first_classification.preferred_auxiliary_source,
        amazon_order_id=(
            single_distinct_value([entry.amazon_order_id for entry in entries])
            if preserve_removal_reference
            else None
        ),
        amazon_adjustment_id=first.amazon_adjustment_id if preserve_removal_reference else None,
        amazon_shipment_id=(
            single_distinct_value([entry.amazon_shipment_id for entry in entries])
            if preserve_removal_reference
            else None
        ),
        latest_posted_date=max(entry.posted_date for entry in entries),
        marketplace_id=first.marketplace_id,
        marketplace_name=single_distinct_value([entry.marketplace_name for entry in entries]),
        currency=first.currency,
        settlement_amount=settlement_amount,
        ledger_entry_ids=tuple(entry.id for entry in entries),
    )


def build_non_direct_group_drafts(
    classified_entries: Sequence[ClassifiedEntry],
    id_factory: Callable[[], str],
) -> list[NonDirectGroupDraft]:
    grouped: defaultdict[NonDirectGroupKey, list[ClassifiedEntry]] = defaultdict(list)
    for item in classified_entries:
        grouped[_group_key(item)].append(item)
    return [
        _build_draft(grouped[key], id_factory) for key in sorted(grouped, key=sortable_group_key)
    ]


__all__ = ["NonDirectGroupDraft", "build_non_direct_group_drafts"]
