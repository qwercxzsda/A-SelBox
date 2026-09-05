"""Normalize the independent sections of one complete Data Kiosk Economics row."""

from collections.abc import Mapping

from ...numeric import NumericBoundError
from .economics_fact_values import (
    normalize_aggregated_detail,
    normalize_properties,
    optional_amount,
    required_amount,
    required_integral_numeric,
)
from .economics_models import (
    EconomicsAdBreakdown,
    EconomicsAmount,
    EconomicsCost,
    EconomicsFeeBreakdown,
    EconomicsFeeComponent,
    EconomicsNetProceeds,
    EconomicsSales,
)
from .economics_parsing import (
    EconomicsRowContext,
    object_value,
    optional_array,
    optional_date,
    optional_object,
    raise_invalid,
    require_contained_interval,
    required_array,
    required_object,
    required_string,
)


def normalize_sales(sales: Mapping[str, object], line_number: int) -> EconomicsSales:
    """Normalize all required sales measures for one DAY/MSKU row."""
    try:
        return EconomicsSales(
            average_selling_price=optional_amount(
                sales,
                "averageSellingPrice",
                line_number,
                "sales",
            ),
            net_product_sales=required_amount(sales, "netProductSales", line_number, "sales"),
            net_units_sold=required_integral_numeric(
                sales,
                "netUnitsSold",
                line_number,
                "sales.netUnitsSold",
            ),
            ordered_product_sales=required_amount(
                sales,
                "orderedProductSales",
                line_number,
                "sales",
            ),
            refunded_product_sales=required_amount(
                sales,
                "refundedProductSales",
                line_number,
                "sales",
            ),
            units_ordered=required_integral_numeric(
                sales,
                "unitsOrdered",
                line_number,
                "sales.unitsOrdered",
            ),
            units_refunded=required_integral_numeric(
                sales,
                "unitsRefunded",
                line_number,
                "sales.unitsRefunded",
            ),
        )
    except NumericBoundError:
        raise
    except ValueError:
        raise_invalid(line_number, "sales consistency")


def normalize_fees(
    row: Mapping[str, object],
    context: EconomicsRowContext,
) -> tuple[EconomicsFeeBreakdown, ...]:
    """Flatten fee summaries into their native charge subperiods."""
    fees: list[EconomicsFeeBreakdown] = []
    for fee_index, fee_value in enumerate(required_array(row, "fees", context.source_line_number)):
        fee_path = f"fees[{fee_index}]"
        fee_summary = object_value(fee_value, context.source_line_number, fee_path)
        fee_type_name = required_string(
            fee_summary,
            "feeTypeName",
            context.source_line_number,
        )
        for charge_index, charge_value in enumerate(
            optional_array(fee_summary, "charges", context.source_line_number)
        ):
            fees.append(
                _normalize_fee_charge(
                    charge_value,
                    context,
                    fee_type_name=fee_type_name,
                    path=f"{fee_path}.charges[{charge_index}]",
                )
            )
    return tuple(fees)


def _normalize_fee_charge(
    charge_value: object,
    context: EconomicsRowContext,
    *,
    fee_type_name: str,
    path: str,
) -> EconomicsFeeBreakdown:
    line_number = context.source_line_number
    charge = object_value(charge_value, line_number, path)
    start_date = optional_date(charge, "startDate", line_number)
    end_date = optional_date(charge, "endDate", line_number)
    require_contained_interval(context, start_date, end_date, f"{path}.startDate/endDate")
    aggregated = required_object(charge, "aggregatedDetail", line_number, path)
    return EconomicsFeeBreakdown(
        fee_type_name=fee_type_name,
        identifier=required_string(charge, "identifier", line_number),
        start_date=start_date,
        end_date=end_date,
        aggregated_detail=normalize_aggregated_detail(
            aggregated,
            line_number,
            f"{path}.aggregatedDetail",
        ),
        components=_normalize_fee_components(charge, line_number, path),
        properties=normalize_properties(charge, "properties", line_number, path),
    )


def _normalize_fee_components(
    charge: Mapping[str, object],
    line_number: int,
    path: str,
) -> tuple[EconomicsFeeComponent, ...]:
    components: list[EconomicsFeeComponent] = []
    for component_index, component_value in enumerate(
        optional_array(charge, "components", line_number)
    ):
        component_path = f"{path}.components[{component_index}]"
        component = object_value(component_value, line_number, component_path)
        aggregated = required_object(
            component,
            "aggregatedDetail",
            line_number,
            component_path,
        )
        components.append(
            EconomicsFeeComponent(
                name=required_string(component, "name", line_number),
                aggregated_detail=normalize_aggregated_detail(
                    aggregated,
                    line_number,
                    f"{component_path}.aggregatedDetail",
                ),
                properties=normalize_properties(
                    component,
                    "properties",
                    line_number,
                    component_path,
                ),
            )
        )
    return tuple(components)


def normalize_ads(
    row: Mapping[str, object],
    line_number: int,
) -> tuple[EconomicsAdBreakdown, ...]:
    """Normalize nullable advertising summaries without inventing charges."""
    ads: list[EconomicsAdBreakdown] = []
    for ad_index, ad_value in enumerate(optional_array(row, "ads", line_number)):
        ad_path = f"ads[{ad_index}]"
        ad = object_value(ad_value, line_number, ad_path)
        charge = optional_object(ad, "charge", line_number, ad_path)
        ads.append(
            EconomicsAdBreakdown(
                ad_type_name=required_string(ad, "adTypeName", line_number),
                charge=(
                    None
                    if charge is None
                    else normalize_aggregated_detail(
                        charge,
                        line_number,
                        f"{ad_path}.charge",
                    )
                ),
            )
        )
    return tuple(ads)


def normalize_cost(
    row: Mapping[str, object],
    line_number: int,
) -> EconomicsCost | None:
    """Normalize optional seller-provided cost sections."""
    cost = optional_object(row, "cost", line_number, "economics")
    if cost is None:
        return None
    fba_cost = optional_object(cost, "fbaCost", line_number, "cost")
    mfn_cost = optional_object(cost, "mfnCost", line_number, "cost")
    return EconomicsCost(
        cost_of_goods_sold=optional_amount(cost, "costOfGoodsSold", line_number, "cost"),
        shipping_to_amazon_cost=_optional_nested_amount(
            fba_cost,
            "shippingToAmazonCost",
            line_number,
            "cost.fbaCost",
        ),
        mfn_fulfillment_cost=_optional_nested_amount(
            mfn_cost,
            "fulfillmentCost",
            line_number,
            "cost.mfnCost",
        ),
        mfn_storage_cost=_optional_nested_amount(
            mfn_cost,
            "storageCost",
            line_number,
            "cost.mfnCost",
        ),
        miscellaneous_cost=optional_amount(cost, "miscellaneousCost", line_number, "cost"),
    )


def _optional_nested_amount(
    owner: Mapping[str, object] | None,
    key: str,
    line_number: int,
    path: str,
) -> EconomicsAmount | None:
    if owner is None:
        return None
    return optional_amount(owner, key, line_number, path)


def normalize_net_proceeds(
    net_proceeds: Mapping[str, object],
    line_number: int,
) -> EconomicsNetProceeds:
    """Normalize Amazon-calculated per-unit and total net proceeds."""
    return EconomicsNetProceeds(
        per_unit=optional_amount(net_proceeds, "perUnit", line_number, "netProceeds"),
        total=optional_amount(net_proceeds, "total", line_number, "netProceeds"),
    )


__all__ = [
    "normalize_ads",
    "normalize_cost",
    "normalize_fees",
    "normalize_net_proceeds",
    "normalize_sales",
]
