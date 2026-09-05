"""Plan Settlement rows whose MSKU is already authoritative."""

from collections import defaultdict
from collections.abc import Callable, Sequence
from datetime import date
from typing import cast

from ..numeric import ZERO, Numeric
from .classification import CompanySkuFeeRateCandidateIndex, resolve_company
from .grouping_values import single_distinct_value, sortable_group_key
from .models import (
    AllocationGroupPlan,
    AllocationTargetPlan,
    ClassifiedEntry,
    CompanyResolution,
)
from .quantities import settlement_metric_quantity

_FEE_BASE_CATEGORIES = frozenset({"PRODUCT_SALES"})

type DirectGroupKey = tuple[
    str | None,
    str | None,
    str | None,
    date,
    str,
    str,
]


def _consistent_optional_value(
    values: Sequence[str | None],
    field_name: str,
) -> str | None:
    distinct = {value for value in values if value is not None}
    if len(distinct) > 1:
        raise ValueError(f"Direct settlement group has conflicting {field_name} values.")
    return next(iter(distinct)) if distinct else None


def is_direct_entry(item: ClassifiedEntry) -> bool:
    return item.handling_method == "DIRECT_SKU" and item.ledger_entry.amz_sku is not None


def _direct_group_key(item: ClassifiedEntry) -> DirectGroupKey:
    """Use order/date/MSKU grain, with adjustment or shipment only as fallback."""
    entry = item.ledger_entry
    fallback_adjustment_id = entry.amazon_adjustment_id if entry.amazon_order_id is None else None
    fallback_shipment_id = (
        entry.amazon_shipment_id
        if entry.amazon_order_id is None and fallback_adjustment_id is None
        else None
    )
    return (
        entry.amazon_order_id,
        fallback_adjustment_id,
        fallback_shipment_id,
        entry.posted_date,
        cast(str, entry.amz_sku),
        entry.currency,
    )


def _selbox_fee_values(
    settlement_amount: Numeric,
    category_code: str,
    company: CompanyResolution | None,
) -> tuple[Numeric, Numeric | None, Numeric]:
    fee_base = settlement_amount if category_code in _FEE_BASE_CATEGORIES else ZERO
    if company is None:
        return fee_base, None, ZERO
    if not fee_base or not company.fee_rate_percent:
        return fee_base, company.fee_rate_percent, ZERO
    fee = -(fee_base * company.fee_rate_percent * Numeric("0.01"))
    return fee_base, company.fee_rate_percent, fee


def _build_target(
    classified_entries: Sequence[ClassifiedEntry],
    group_id: str,
    settlement_amount: Numeric,
    marketplace_id: str | None,
    amz_sku: str,
    company: CompanyResolution | None,
    id_factory: Callable[[], str],
) -> AllocationTargetPlan:
    fee_base, fee_rate_percent, selbox_fee = _selbox_fee_values(
        settlement_amount,
        classified_entries[0].category_code,
        company,
    )
    quantity = settlement_metric_quantity([item.ledger_entry for item in classified_entries])
    fee_quantity = quantity if classified_entries[0].category_code in _FEE_BASE_CATEGORIES else None
    return AllocationTargetPlan(
        id=id_factory(),
        allocation_group_id=group_id,
        company_id=company.company_id if company else None,
        company_sku_fee_rate_id=(company.company_sku_fee_rate_id if company else None),
        fee_rate_percent=fee_rate_percent,
        marketplace_id=marketplace_id,
        amz_sku=amz_sku,
        join_method="DIRECT_SETTLEMENT",
        unassigned_reason=None if company else "MISSING_COMPANY_ASSIGNMENT",
        settlement_amount=settlement_amount,
        elaborated_amount=settlement_amount,
        selbox_fee_base=fee_base,
        selbox_fee=selbox_fee,
        settlement_quantity=quantity,
        elaborated_quantity=quantity,
        selbox_fee_base_quantity=fee_quantity,
        selbox_fee_quantity=fee_quantity if company else None,
        company_payable_quantity=quantity,
        activity_start_date=classified_entries[0].ledger_entry.posted_date,
        activity_end_date=classified_entries[0].ledger_entry.posted_date,
    )


def _build_group(
    classified_entries: Sequence[ClassifiedEntry],
    marketplace_id: str | None,
    marketplace_name: str | None,
    fee_rates_by_key: CompanySkuFeeRateCandidateIndex,
    id_factory: Callable[[], str],
) -> AllocationGroupPlan:
    entries = [item.ledger_entry for item in classified_entries]
    first = entries[0]
    group_id = id_factory()
    settlement_amount = sum((entry.settlement_amount for entry in entries), ZERO)
    amz_sku = cast(str, first.amz_sku)
    company = resolve_company(
        marketplace_id,
        amz_sku,
        first.posted_date,
        fee_rates_by_key,
    )
    target = _build_target(
        classified_entries,
        group_id,
        settlement_amount,
        marketplace_id,
        amz_sku,
        company,
        id_factory,
    )
    return AllocationGroupPlan(
        id=group_id,
        category_code=classified_entries[0].category_code,
        handling_method="DIRECT_SKU",
        pnl_treatment="SKU_PNL",
        amazon_order_id=first.amazon_order_id,
        amazon_adjustment_id=single_distinct_value(
            [entry.amazon_adjustment_id for entry in entries]
        ),
        amazon_shipment_id=single_distinct_value([entry.amazon_shipment_id for entry in entries]),
        representative_date=first.posted_date,
        marketplace_id=marketplace_id,
        marketplace_name=marketplace_name,
        currency=first.currency,
        settlement_amount=settlement_amount,
        ledger_entry_ids=tuple(entry.id for entry in entries),
        targets=(target,),
    )


def build_direct_groups(
    classified_entries: Sequence[ClassifiedEntry],
    fee_rates_by_key: CompanySkuFeeRateCandidateIndex,
    id_factory: Callable[[], str],
) -> list[AllocationGroupPlan]:
    grouped: defaultdict[DirectGroupKey, list[ClassifiedEntry]] = defaultdict(list)
    for item in classified_entries:
        grouped[_direct_group_key(item)].append(item)
    groups: list[AllocationGroupPlan] = []
    for key in sorted(grouped, key=sortable_group_key):
        entries = grouped[key]
        marketplace_id = _consistent_optional_value(
            [item.ledger_entry.marketplace_id for item in entries],
            "marketplace_id",
        )
        marketplace_name = _consistent_optional_value(
            [item.ledger_entry.marketplace_name for item in entries],
            "marketplace_name",
        )
        categories: defaultdict[str, list[ClassifiedEntry]] = defaultdict(list)
        for item in entries:
            categories[item.category_code].append(item)
        groups.extend(
            _build_group(
                categories[category],
                marketplace_id,
                marketplace_name,
                fee_rates_by_key,
                id_factory,
            )
            for category in sorted(categories)
        )
    return groups


__all__ = ["build_direct_groups", "is_direct_entry"]
