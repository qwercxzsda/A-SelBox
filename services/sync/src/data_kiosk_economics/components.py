"""Explicit economic source mappings, preserving tax-inclusive source detail once."""

from dataclasses import fields

from ..allocation import AllocationCategory
from ..amazon.data_kiosk.economics_models import (
    DailyMskuEconomicsFact,
    EconomicsAggregatedDetail,
    EconomicsAmount,
)
from ..amazon.data_kiosk.economics_taxonomy import canonicalize_economics_taxonomy
from ..numeric import Numeric
from ..source_serialization import content_sha256, source_mapping
from .errors import UnresolvedDataKioskComponentError
from .models import DataKioskTransaction

# These are explicit observed/schema aliases, not substring matching. Unknown
# monetary labels fail Python preprocessing before any replacement is published.
_SETTLEMENT_FEES = frozenset(
    {
        "REFERRAL_FEE",
        "REFERRAL_FEES",
        "FBA_FULFILMENT_FEE",
        "FBA_FULFILLMENT_FEE",
        "FBA_FULFILLMENT_FEES",
        "DIGITAL_SERVICES_FEE_FBA",
        "DIGITAL_SERVICES_FEE_SOA",
        "REFUNDED_REFERRAL_FEE",
        "REFUND_COMMISSION_FEE",
        "FBA_INVENTORY_REIMBURSEMENT",
        "LIQUIDATION_PROCESSING_FEE",
        "LIQUIDATION_REFERRAL_FEE",
    }
)
_ACCOUNT_FEES = frozenset({"SUBSCRIPTION_FEE"})
_COMPANY_FEES = frozenset(
    {
        "DISPOSAL_FEE",
        "REMOVAL_FEE",
        "LABELING_FEE",
        "LONG_TERM_STORAGE_FEE",
        "FBA_STORAGE_FEE",
        "MONTHLY_INVENTORY_STORAGE_FEE",
        "FBA_AGED_INVENTORY_SURCHARGE",
        "FBA_INBOUND_CONVENIENCE_FEE",
        "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
        "FBA_INBOUND_TRANSPORTATION_FEE",
        "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE",
        "COUPON_PARTICIPATION_FEE",
        "COUPON_PERFORMANCE_FEE",
        "DEAL_PARTICIPATION_FEE",
        "DEAL_PERFORMANCE_FEE",
    }
)
_ADS = frozenset(
    {
        "SPONSORED_PRODUCT_FEE",
        "SPONSORED_PRODUCTS",
        "SPONSORED_PRODUCTS_CHARGE",
        "SPONSORED_PRODUCTS_CHARGES",
        "SPONSORED_BRANDS",
        "SPONSORED_BRANDS_CHARGE",
        "SPONSORED_BRANDS_CHARGES",
        "SPONSORED_DISPLAY",
        "SPONSORED_DISPLAY_CHARGE",
        "SPONSORED_DISPLAY_CHARGES",
    }
)


def classify_fee(label: str, *, source_line_number: int | None = None) -> AllocationCategory:
    normalized = canonicalize_economics_taxonomy(label)
    if normalized in _SETTLEMENT_FEES:
        return AllocationCategory.SETTLEMENT
    if normalized in _ACCOUNT_FEES:
        return AllocationCategory.SELBOX
    if normalized in _COMPANY_FEES:
        return AllocationCategory.DATA_KIOSK
    raise UnresolvedDataKioskComponentError(
        "UNKNOWN_FEE", collection="fees", label=label, source_line_number=source_line_number
    )


def build_components(fact: DailyMskuEconomicsFact) -> tuple[DataKioskTransaction, ...]:
    """Keep one amount per native fee subperiod and retain its whole breakdown."""
    if fact.unresolved_fee_types:
        raise UnresolvedDataKioskComponentError(
            "MISSING_FEE_CHARGES",
            collection="fees",
            label=fact.unresolved_fee_types[0],
            source_line_number=fact.source_line_number,
        )
    if fact.ads_unavailable:
        raise UnresolvedDataKioskComponentError(
            "MISSING_ADS", collection="ads", source_line_number=fact.source_line_number
        )
    sales = fact.sales
    rows = [
        _component(
            fact,
            "NET_PRODUCT_SALES",
            sales.net_product_sales,
            category=AllocationCategory.SETTLEMENT,
            quantity=sales.net_units_sold,
            fee_base=sales.net_product_sales.amount,
            dimensions={
                "sales": source_mapping(sales),
                "net_proceeds": source_mapping(fact.net_proceeds),
                "cost": None if fact.cost is None else source_mapping(fact.cost),
            },
            identity={"collection": "sales"},
        )
    ]
    rows.extend(_fee_components(fact))
    rows.extend(_ad_components(fact))
    rows.extend(_cost_components(fact))
    keys = [row.component_key for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate Data Kiosk economic component identity in one DAY/MSKU row.")
    return tuple(rows)


def _fee_components(fact: DailyMskuEconomicsFact) -> list[DataKioskTransaction]:
    rows: list[DataKioskTransaction] = []
    for fee in fact.fees:
        _validate_total(fee.aggregated_detail)
        for part in fee.components:
            _validate_total(part.aggregated_detail)
        category = classify_fee(fee.fee_type_name, source_line_number=fact.source_line_number)
        rows.append(
            _component(
                fact,
                canonicalize_economics_taxonomy(fee.fee_type_name),
                fee.aggregated_detail.total_amount,
                category=category,
                quantity=fee.aggregated_detail.quantity,
                negate=True,
                dimensions={"fee": source_mapping(fee)},
                identity={
                    "collection": "fees",
                    "fee_type_name": fee.fee_type_name,
                    "identifier": fee.identifier,
                    "start_date": fee.start_date,
                    "end_date": fee.end_date,
                    "properties": sorted((p.name, p.value) for p in fee.properties),
                },
            )
        )
    return rows


def _ad_components(fact: DailyMskuEconomicsFact) -> list[DataKioskTransaction]:
    rows: list[DataKioskTransaction] = []
    for ad in fact.ads:
        if ad.charge is None:
            raise UnresolvedDataKioskComponentError(
                "MISSING_AD_CHARGE",
                collection="ads",
                label=ad.ad_type_name,
                source_line_number=fact.source_line_number,
            )
        _validate_total(ad.charge)
        label = canonicalize_economics_taxonomy(ad.ad_type_name)
        if label not in _ADS:
            raise UnresolvedDataKioskComponentError(
                "UNKNOWN_AD",
                collection="ads",
                label=ad.ad_type_name,
                source_line_number=fact.source_line_number,
            )
        rows.append(
            _component(
                fact,
                label,
                ad.charge.total_amount,
                category=AllocationCategory.DATA_KIOSK,
                quantity=ad.charge.quantity,
                negate=True,
                dimensions={"ad": source_mapping(ad)},
                identity={"collection": "ads", "ad_type_name": ad.ad_type_name},
            )
        )
    return rows


def _cost_components(fact: DailyMskuEconomicsFact) -> list[DataKioskTransaction]:
    if fact.cost is None:
        return []
    rows: list[DataKioskTransaction] = []
    for field in fields(fact.cost):
        amount: EconomicsAmount | None = getattr(fact.cost, field.name)
        if amount is not None:
            rows.append(
                _component(
                    fact,
                    field.name.upper(),
                    amount,
                    category=AllocationCategory.ANALYSIS_ONLY,
                    dimensions={"cost_field": field.name},
                    identity={"collection": "cost", "field": field.name},
                )
            )
    return rows


def _validate_total(detail: EconomicsAggregatedDetail) -> None:
    if detail.total_amount.amount != (
        detail.amount.amount - detail.promotion_amount.amount + detail.tax_amount.amount
    ):
        raise ValueError("Data Kiosk totalAmount must equal amount - promotionAmount + taxAmount.")


def _component(
    fact: DailyMskuEconomicsFact,
    component_type: str,
    amount: EconomicsAmount,
    *,
    category: AllocationCategory,
    dimensions: dict[str, object],
    identity: dict[str, object],
    quantity: Numeric | None = None,
    fee_base: Numeric | None = None,
    negate: bool = False,
) -> DataKioskTransaction:
    return DataKioskTransaction(
        component_key=content_sha256({"sku": fact.msku, **identity}),
        sku=fact.msku,
        category=category,
        component_type=component_type,
        amount=-amount.amount if negate else amount.amount,
        currency=amount.currency_code,
        quantity=quantity,
        fee_base=fee_base,
        native_dimensions={
            "child_asin": fact.child_asin,
            "parent_asin": fact.parent_asin,
            "fnsku": fact.fnsku,
            **dimensions,
        },
        source_document_id=fact.source_document_id,
        source_line_number=fact.source_line_number,
    )
