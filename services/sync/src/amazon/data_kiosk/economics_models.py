"""Exact typed values from one DAY/MSKU Data Kiosk Economics row."""

from dataclasses import dataclass, field
from datetime import date

from ...numeric import Numeric


@dataclass(frozen=True)
class EconomicsAmount:
    """One source-reported monetary amount without scale coercion."""

    amount: Numeric
    currency_code: str


@dataclass(frozen=True)
class EconomicsAggregatedDetail:
    """Amazon's complete amount, quantity, and per-unit calculation."""

    amount: EconomicsAmount
    amount_per_unit: EconomicsAmount | None
    amount_per_unit_delta: EconomicsAmount | None
    promotion_amount: EconomicsAmount
    quantity: Numeric | None
    tax_amount: EconomicsAmount
    total_amount: EconomicsAmount


@dataclass(frozen=True)
class EconomicsProperty:
    """One source property used by Amazon to calculate a fee."""

    name: str
    value: str


@dataclass(frozen=True)
class EconomicsFeeComponent:
    """A named component of a supported fulfillment or storage fee."""

    name: str
    aggregated_detail: EconomicsAggregatedDetail
    properties: tuple[EconomicsProperty, ...]


@dataclass(frozen=True)
class EconomicsFeeBreakdown:
    """One native fee/rate subperiod in a daily MSKU fact."""

    fee_type_name: str
    identifier: str
    start_date: date | None
    end_date: date | None
    aggregated_detail: EconomicsAggregatedDetail
    components: tuple[EconomicsFeeComponent, ...]
    properties: tuple[EconomicsProperty, ...]


@dataclass(frozen=True)
class EconomicsAdBreakdown:
    """One advertising charge summary for a daily MSKU fact."""

    ad_type_name: str
    charge: EconomicsAggregatedDetail | None


@dataclass(frozen=True)
class EconomicsSales:
    """Complete source sales metrics for one DAY/MSKU row."""

    average_selling_price: EconomicsAmount | None
    net_product_sales: EconomicsAmount
    net_units_sold: Numeric
    ordered_product_sales: EconomicsAmount
    refunded_product_sales: EconomicsAmount
    units_ordered: Numeric
    units_refunded: Numeric

    def __post_init__(self) -> None:
        """Keep the source sales section internally exact before processing."""
        for field_name, value in (
            ("net_units_sold", self.net_units_sold),
            ("units_ordered", self.units_ordered),
            ("units_refunded", self.units_refunded),
        ):
            if value.value != value.value.to_integral_value():
                raise ValueError(f"{field_name} must be a finite integer.")
        if self.units_ordered < 0 or self.units_refunded < 0:
            raise ValueError("Ordered and refunded unit counts must not be negative.")
        if self.net_units_sold != self.units_ordered - self.units_refunded:
            raise ValueError("Net units sold must equal ordered units minus refunded units.")

        amounts = (
            self.average_selling_price,
            self.net_product_sales,
            self.ordered_product_sales,
            self.refunded_product_sales,
        )
        currencies = {amount.currency_code for amount in amounts if amount is not None}
        if len(currencies) != 1:
            raise ValueError("Sales amounts must use exactly one currency.")
        if self.net_product_sales.amount != (
            self.ordered_product_sales.amount - abs(self.refunded_product_sales.amount)
        ):
            raise ValueError("Net product sales must equal sales minus the refund magnitude.")


@dataclass(frozen=True)
class EconomicsCost:
    """Optional seller-provided per-unit costs flattened by purpose."""

    cost_of_goods_sold: EconomicsAmount | None
    shipping_to_amazon_cost: EconomicsAmount | None
    mfn_fulfillment_cost: EconomicsAmount | None
    mfn_storage_cost: EconomicsAmount | None
    miscellaneous_cost: EconomicsAmount | None


@dataclass(frozen=True)
class EconomicsNetProceeds:
    """Amazon-calculated net proceeds for one DAY/MSKU row."""

    per_unit: EconomicsAmount | None
    total: EconomicsAmount | None


@dataclass(frozen=True)
class DailyMskuEconomicsFact:
    """One complete marketplace-local DAY/MSKU Data Kiosk Economics fact."""

    start_date: date
    end_date: date
    marketplace_id: str
    msku: str
    child_asin: str | None
    fnsku: str | None
    parent_asin: str
    sales: EconomicsSales
    fees: tuple[EconomicsFeeBreakdown, ...]
    ads: tuple[EconomicsAdBreakdown, ...]
    cost: EconomicsCost | None
    net_proceeds: EconomicsNetProceeds
    source_line_number: int
    document_sha256: str
    source_document_id: str = field(repr=False)

    @property
    def natural_key(self) -> tuple[str, date, date, str]:
        """Return the API-native marketplace/date/MSKU identity."""
        return (self.marketplace_id, self.start_date, self.end_date, self.msku)


__all__ = [
    "DailyMskuEconomicsFact",
    "EconomicsAdBreakdown",
    "EconomicsAggregatedDetail",
    "EconomicsAmount",
    "EconomicsCost",
    "EconomicsFeeBreakdown",
    "EconomicsFeeComponent",
    "EconomicsNetProceeds",
    "EconomicsProperty",
    "EconomicsSales",
]
