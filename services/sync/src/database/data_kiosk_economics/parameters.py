"""Convert in-memory Data Kiosk facts into exact PostgreSQL parameters."""

import json
from collections.abc import Iterable, Mapping, Sequence

from ...amazon.data_kiosk.economics_models import (
    DailyMskuEconomicsFact,
    EconomicsAggregatedDetail,
    EconomicsAmount,
    EconomicsFeeBreakdown,
    EconomicsProperty,
)
from ...numeric import ZERO, Numeric
from ..company_sku_fee_rates import CompanySkuFeeRate, calculate_selbox_fee
from ..values import numeric_parameters
from .models import DataKioskProvisionCurrencyError, DataKioskProvisionRefresh


def provision_parameters(
    refresh: DataKioskProvisionRefresh,
    fact: DailyMskuEconomicsFact,
    fee_rate: CompanySkuFeeRate,
    *,
    processing_log_id: str,
) -> dict[str, object]:
    """Validate one fact's currency and serialize its amounts without rounding."""
    currency = _fact_currency(fact)
    product_sales = fact.sales.ordered_product_sales.amount
    product_refunds = abs(fact.sales.refunded_product_sales.amount)
    applied_rate = fee_rate.fee_rate_percent
    cost = fact.cost
    return numeric_parameters(
        {
            "processing_log_id": processing_log_id,
            "seller_namespace": refresh.seller_namespace,
            "amazon_scope": refresh.amazon_scope,
            "marketplace_id": fact.marketplace_id,
            "activity_date": fact.start_date,
            "sku": fact.msku,
            "currency": currency,
            "company_sku_fee_rate_id": fee_rate.id,
            "company_id": fee_rate.company_id,
            "child_asin": fact.child_asin,
            "fnsku": fact.fnsku,
            "parent_asin": fact.parent_asin,
            "units_sold": fact.sales.units_ordered,
            "units_returned": fact.sales.units_refunded,
            "net_units_sold": fact.sales.net_units_sold,
            "average_sales_price": _amount(fact.sales.average_selling_price),
            "product_sales": product_sales,
            "product_refunds": product_refunds,
            "net_product_sales": fact.sales.net_product_sales.amount,
            "amazon_fee_total": sum(
                (fee.aggregated_detail.total_amount.amount for fee in fact.fees), ZERO
            ),
            "amazon_fee_total_quantity": _total_quantity(
                fee.aggregated_detail for fee in fact.fees
            ),
            "advertising_total": sum(
                (ad.charge.total_amount.amount for ad in fact.ads if ad.charge is not None), ZERO
            ),
            "advertising_total_quantity": _total_quantity(
                ad.charge for ad in fact.ads if ad.charge is not None
            ),
            "cost_of_goods_sold_per_unit": (
                _amount(cost.cost_of_goods_sold) if cost is not None else None
            ),
            "shipping_to_amazon_cost_per_unit": (
                _amount(cost.shipping_to_amazon_cost) if cost is not None else None
            ),
            "mfn_fulfillment_cost_per_unit": (
                _amount(cost.mfn_fulfillment_cost) if cost is not None else None
            ),
            "mfn_storage_cost_per_unit": (
                _amount(cost.mfn_storage_cost) if cost is not None else None
            ),
            "miscellaneous_cost_per_unit": (
                _amount(cost.miscellaneous_cost) if cost is not None else None
            ),
            "net_proceeds_per_unit": _amount(fact.net_proceeds.per_unit),
            "net_proceeds_total": _amount(fact.net_proceeds.total),
            "net_proceeds_total_quantity": None,
            "fee_breakdown": _json([_fee_payload(fee) for fee in fact.fees]),
            "ad_breakdown": _json([_ad_payload(ad.ad_type_name, ad.charge) for ad in fact.ads]),
            "selbox_fee_base": product_sales,
            "applied_fee_rate_percent": applied_rate,
            "selbox_fee": calculate_selbox_fee(product_sales, applied_rate),
            "refreshed_at": refresh.refreshed_at,
        }
    )


def _total_quantity(details: Iterable[EconomicsAggregatedDetail]) -> Numeric | None:
    """Only one source detail establishes a denominator for an aggregate total."""
    source_details = tuple(details)
    if not source_details:
        return ZERO
    return source_details[0].quantity if len(source_details) == 1 else None


def _fact_currency(fact: DailyMskuEconomicsFact) -> str:
    currencies = {amount.currency_code for amount in _fact_amounts(fact) if amount is not None}
    if len(currencies) != 1:
        raise DataKioskProvisionCurrencyError
    return next(iter(currencies))


def _fact_amounts(fact: DailyMskuEconomicsFact) -> tuple[EconomicsAmount | None, ...]:
    cost = fact.cost
    amounts: list[EconomicsAmount | None] = [
        fact.sales.average_selling_price,
        fact.sales.net_product_sales,
        fact.sales.ordered_product_sales,
        fact.sales.refunded_product_sales,
        fact.net_proceeds.per_unit,
        fact.net_proceeds.total,
    ]
    for fee in fact.fees:
        amounts.extend(_detail_amounts(fee.aggregated_detail))
        for component in fee.components:
            amounts.extend(_detail_amounts(component.aggregated_detail))
    for ad in fact.ads:
        if ad.charge is not None:
            amounts.extend(_detail_amounts(ad.charge))
    if cost is not None:
        amounts.extend(
            (
                cost.cost_of_goods_sold,
                cost.shipping_to_amazon_cost,
                cost.mfn_fulfillment_cost,
                cost.mfn_storage_cost,
                cost.miscellaneous_cost,
            )
        )
    return tuple(amounts)


def _detail_amounts(detail: EconomicsAggregatedDetail) -> tuple[EconomicsAmount | None, ...]:
    return (
        detail.amount,
        detail.amount_per_unit,
        detail.amount_per_unit_delta,
        detail.promotion_amount,
        detail.tax_amount,
        detail.total_amount,
    )


def _fee_payload(fee: EconomicsFeeBreakdown) -> Mapping[str, object]:
    return {
        "fee_type_name": fee.fee_type_name,
        "identifier": fee.identifier,
        "start_date": None if fee.start_date is None else fee.start_date.isoformat(),
        "end_date": None if fee.end_date is None else fee.end_date.isoformat(),
        "aggregated_detail": _detail_payload(fee.aggregated_detail),
        "properties": _properties_payload(fee.properties),
        "components": [
            {
                "name": component.name,
                "aggregated_detail": _detail_payload(component.aggregated_detail),
                "properties": _properties_payload(component.properties),
            }
            for component in fee.components
        ],
    }


def _ad_payload(
    ad_type_name: str,
    charge: EconomicsAggregatedDetail | None,
) -> Mapping[str, object]:
    return {
        "ad_type_name": ad_type_name,
        "charge": None if charge is None else _detail_payload(charge),
    }


def _detail_payload(detail: EconomicsAggregatedDetail) -> Mapping[str, object]:
    return {
        "amount": _amount_payload(detail.amount),
        "amount_per_unit": _amount_payload(detail.amount_per_unit),
        "amount_per_unit_delta": _amount_payload(detail.amount_per_unit_delta),
        "promotion_amount": _amount_payload(detail.promotion_amount),
        "quantity": None if detail.quantity is None else str(detail.quantity),
        "tax_amount": _amount_payload(detail.tax_amount),
        "total_amount": _amount_payload(detail.total_amount),
    }


def _amount_payload(amount: EconomicsAmount | None) -> Mapping[str, str] | None:
    if amount is None:
        return None
    return {"amount": str(amount.amount), "currency": amount.currency_code}


def _properties_payload(properties: Sequence[EconomicsProperty]) -> list[Mapping[str, str]]:
    return [{"name": value.name, "value": value.value} for value in properties]


def _amount(value: EconomicsAmount | None) -> Numeric | None:
    return None if value is None else value.amount


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


__all__ = ["provision_parameters"]
