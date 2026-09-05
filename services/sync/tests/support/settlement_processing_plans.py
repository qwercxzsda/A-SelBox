"""Shared typed builders for pure Settlement processing-plan tests."""

from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, time
from itertools import count

from ...src.amazon.settlement_values import parse_settlement_amount
from ...src.settlement_processing.models import (
    AllocationGroupPlan,
    AuxiliaryFeeObservation,
    AuxiliarySourceSystem,
    CategoryMappingRule,
    CompanySkuFeeRateCandidate,
    LedgerEntry,
)
from ...src.settlement_processing.planning import build_allocation_groups


def make_id_factory() -> Callable[[], str]:
    sequence = count(1)
    return lambda: f"00000000-0000-0000-0000-{next(sequence):012d}"


def make_ledger_entry(
    entry_id: str,
    amount: str,
    *,
    transaction_type: str = "Order",
    amount_type: str = "ItemPrice",
    amount_description: str = "Principal",
    order_id: str | None = "order-1",
    sku: str | None = "SKU-1",
    marketplace_id: str | None = "ATVPDKIKX0DER",
    marketplace_name: str | None = "Amazon.com",
    adjustment_id: str | None = None,
    shipment_id: str | None = None,
    posted_date: date = date(2026, 8, 20),
    quantity: int | None = 1,
) -> LedgerEntry:
    return LedgerEntry(
        id=entry_id,
        settlement_report_id="settlement-1",
        settlement_report_line_id=f"raw-{entry_id}",
        posted_date=posted_date,
        posted_at=datetime.combine(posted_date, time(1), tzinfo=UTC),
        currency="USD",
        settlement_amount=parse_settlement_amount(amount),
        transaction_type=transaction_type,
        amount_type=amount_type,
        amount_description=amount_description,
        amazon_order_id=order_id,
        amazon_order_item_id=None,
        amazon_adjustment_id=adjustment_id,
        amazon_shipment_id=shipment_id,
        marketplace_name=marketplace_name if marketplace_id else None,
        marketplace_id=marketplace_id,
        amz_sku=sku,
        quantity=quantity if sku else None,
    )


def direct_rules() -> list[CategoryMappingRule]:
    return [
        CategoryMappingRule(10, "Order", "ItemPrice", "Principal", "PRODUCT_SALES", "SKU_PNL"),
        CategoryMappingRule(20, None, "Promotion", None, "PROMOTIONAL_REBATES", "SKU_PNL"),
        CategoryMappingRule(30, None, "ItemFees", None, "REFERRAL_FEES", "SKU_PNL"),
    ]


def make_auxiliary_observation(
    amount: str,
    *,
    source_system: AuxiliarySourceSystem = "DATA_KIOSK",
    category_code: str = "FBA_STORAGE_FEES",
    sku: str = "SKU-1",
    marketplace_id: str = "ATVPDKIKX0DER",
    source_start_date: date = date(2026, 8, 1),
    source_end_date: date = date(2026, 8, 31),
    removal_order_id: str | None = None,
) -> AuxiliaryFeeObservation:
    normalized_amount = parse_settlement_amount(amount)
    return AuxiliaryFeeObservation(
        source_system=source_system,
        marketplace_id=marketplace_id,
        source_start_date=source_start_date,
        source_end_date=source_end_date,
        category_code=category_code,
        amz_sku=sku,
        currency="USD",
        reported_amount=-normalized_amount,
        normalized_amount=normalized_amount,
        removal_order_id=removal_order_id,
    )


def build_test_allocation_groups(
    ledger_entries: Sequence[LedgerEntry],
    rules: Sequence[CategoryMappingRule],
    fee_rate_candidates: Sequence[CompanySkuFeeRateCandidate] = (),
    auxiliary_observations: Sequence[AuxiliaryFeeObservation] = (),
    *,
    report_first_date: date = date(2026, 8, 20),
    report_end_date_exclusive: date = date(2026, 8, 21),
    id_factory: Callable[[], str],
) -> tuple[AllocationGroupPlan, ...]:
    return build_allocation_groups(
        ledger_entries,
        rules,
        fee_rate_candidates,
        auxiliary_observations,
        report_first_date,
        report_end_date_exclusive,
        id_factory,
    )


__all__ = [
    "build_test_allocation_groups",
    "direct_rules",
    "make_auxiliary_observation",
    "make_id_factory",
    "make_ledger_entry",
]
