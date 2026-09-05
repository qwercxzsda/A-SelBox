"""Canonical Data Kiosk Economics builders for unit tests."""

from datetime import date

from ...src.amazon.data_kiosk import (
    DailyMskuEconomicsFact,
    EconomicsAdBreakdown,
    EconomicsAggregatedDetail,
    EconomicsAmount,
    EconomicsCost,
    EconomicsFeeBreakdown,
    EconomicsNetProceeds,
    EconomicsSales,
)
from ...src.numeric import Numeric

DEFAULT_ACTIVITY_DATE = date(2026, 8, 1)


def _money(value: str, currency: str = "USD") -> EconomicsAmount:
    return EconomicsAmount(Numeric(value), currency)


def _detail(value: str, currency: str = "USD") -> EconomicsAggregatedDetail:
    return EconomicsAggregatedDetail(
        amount=_money(value, currency),
        amount_per_unit=_money("1.25", currency),
        amount_per_unit_delta=None,
        promotion_amount=_money("0", currency),
        quantity=Numeric(2),
        tax_amount=_money("0", currency),
        total_amount=_money(value, currency),
    )


def complete_economics_fact(
    *,
    marketplace_id: str = "ATVPDKIKX0DER",
    activity_date: date = DEFAULT_ACTIVITY_DATE,
    sku: str = "SKU-1",
    currency: str = "USD",
) -> DailyMskuEconomicsFact:
    """Build one complete normalized provision fact with non-zero values."""
    return DailyMskuEconomicsFact(
        start_date=activity_date,
        end_date=activity_date,
        marketplace_id=marketplace_id,
        msku=sku,
        child_asin="ASIN-1",
        fnsku=None,
        parent_asin="PARENT-1",
        sales=EconomicsSales(
            average_selling_price=_money("10.125", currency),
            net_product_sales=_money("20.25", currency),
            net_units_sold=Numeric(2),
            ordered_product_sales=_money("30.375", currency),
            refunded_product_sales=_money("-10.125", currency),
            units_ordered=Numeric(3),
            units_refunded=Numeric(1),
        ),
        fees=(
            EconomicsFeeBreakdown(
                fee_type_name="ReferralFees",
                identifier="fee-1",
                start_date=activity_date,
                end_date=activity_date,
                aggregated_detail=_detail("2.5000000000000000001", currency),
                components=(),
                properties=(),
            ),
        ),
        ads=(
            EconomicsAdBreakdown(
                "Sponsored Products charge",
                _detail("1.005", currency),
            ),
        ),
        cost=EconomicsCost(
            cost_of_goods_sold=_money("4.125", currency),
            shipping_to_amazon_cost=_money("0.625", currency),
            mfn_fulfillment_cost=None,
            mfn_storage_cost=None,
            miscellaneous_cost=None,
        ),
        net_proceeds=EconomicsNetProceeds(
            per_unit=_money("5.5", currency),
            total=_money("11.0000000000000000002", currency),
        ),
        source_line_number=7,
        document_sha256="d" * 64,
        source_document_id="document-1",
    )


def economics_aggregated_detail(
    total_amount: str,
    *,
    amount: str | None = None,
) -> str:
    """Build one complete USD aggregate around an exact JSON number."""
    total = f'{{"amount":{total_amount},"currencyCode":"USD"}}'
    subtotal = total if amount is None else f'{{"amount":{amount},"currencyCode":"USD"}}'
    zero = '{"amount":0,"currencyCode":"USD"}'
    return (
        f'{{"amount":{subtotal},"amountPerUnit":null,"amountPerUnitDelta":null,'
        f'"promotionAmount":{zero},"quantity":null,"taxAmount":{zero},'
        f'"totalAmount":{total}}}'
    )


def complete_economics_document(
    *,
    msku: str = "SKU-1",
    fees: str = "[]",
    ads: str = "[]",
    start_date: str = "2026-08-01",
    end_date: str = "2026-08-01",
    leading_newline: bool = False,
) -> bytes:
    """Build one complete DAY/MSKU row using raw fee and ad JSON arrays."""
    zero = '{"amount":0,"currencyCode":"USD"}'
    prefix = "\n" if leading_newline else ""
    return (
        f'{prefix}{{"startDate":"{start_date}","endDate":"{end_date}",'
        '"marketplaceId":"ATVPDKIKX0DER",'
        f'"msku":"{msku}","childAsin":null,"fnsku":null,'
        '"parentAsin":"PARENT",'
        '"sales":{"averageSellingPrice":null,'
        f'"netProductSales":{zero},"netUnitsSold":0,'
        f'"orderedProductSales":{zero},"refundedProductSales":{zero},'
        '"unitsOrdered":0,"unitsRefunded":0},'
        f'"fees":{fees},"ads":{ads},"cost":null,'
        '"netProceeds":{"perUnit":null,"total":null}}\n'
    ).encode()


__all__ = [
    "complete_economics_document",
    "complete_economics_fact",
    "economics_aggregated_detail",
]
