"""Parse exact reusable value objects inside complete Data Kiosk Economics facts."""

from collections.abc import Mapping

from ...numeric import Numeric
from .economics_models import (
    EconomicsAggregatedDetail,
    EconomicsAmount,
    EconomicsProperty,
)
from .economics_parsing import (
    object_value,
    optional_array,
    optional_numeric,
    optional_object,
    raise_invalid,
    required_currency_code,
    required_numeric,
    required_object,
    required_string,
)


def normalize_aggregated_detail(
    aggregated: Mapping[str, object],
    line_number: int,
    path: str,
) -> EconomicsAggregatedDetail:
    """Parse one complete aggregate and require one currency throughout it."""
    detail = EconomicsAggregatedDetail(
        amount=required_amount(aggregated, "amount", line_number, path),
        amount_per_unit=optional_amount(
            aggregated,
            "amountPerUnit",
            line_number,
            path,
        ),
        amount_per_unit_delta=optional_amount(
            aggregated,
            "amountPerUnitDelta",
            line_number,
            path,
        ),
        promotion_amount=required_amount(
            aggregated,
            "promotionAmount",
            line_number,
            path,
        ),
        quantity=optional_numeric(
            aggregated,
            "quantity",
            line_number,
            f"{path}.quantity",
        ),
        tax_amount=required_amount(aggregated, "taxAmount", line_number, path),
        total_amount=required_amount(aggregated, "totalAmount", line_number, path),
    )
    currencies = {
        amount.currency_code
        for amount in (
            detail.amount,
            detail.amount_per_unit,
            detail.amount_per_unit_delta,
            detail.promotion_amount,
            detail.tax_amount,
            detail.total_amount,
        )
        if amount is not None
    }
    if len(currencies) != 1:
        raise_invalid(line_number, f"{path} currencyCode consistency")
    return detail


def normalize_properties(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    path: str,
) -> tuple[EconomicsProperty, ...]:
    """Parse a nullable property collection without inventing missing values."""
    properties: list[EconomicsProperty] = []
    for property_index, property_value in enumerate(optional_array(owner, key, line_number)):
        property_path = f"{path}.{key}[{property_index}]"
        property_object = object_value(property_value, line_number, property_path)
        properties.append(
            EconomicsProperty(
                name=required_string(property_object, "propertyName", line_number),
                value=required_string(property_object, "propertyValue", line_number),
            )
        )
    return tuple(properties)


def required_amount(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    owner_path: str,
) -> EconomicsAmount:
    value = required_object(owner, key, line_number, owner_path)
    return _amount_value(value, line_number, f"{owner_path}.{key}")


def optional_amount(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    owner_path: str,
) -> EconomicsAmount | None:
    value = optional_object(owner, key, line_number, owner_path)
    if value is None:
        return None
    return _amount_value(value, line_number, f"{owner_path}.{key}")


def required_integral_numeric(
    owner: Mapping[str, object],
    key: str,
    line_number: int,
    path: str,
) -> Numeric:
    value = required_numeric(owner, key, line_number, path)
    if value.value != value.value.to_integral_value():
        raise_invalid(line_number, path)
    return value


def _amount_value(
    value: Mapping[str, object],
    line_number: int,
    path: str,
) -> EconomicsAmount:
    amount = required_numeric(value, "amount", line_number, f"{path}.amount")
    currency_code = required_currency_code(
        value,
        "currencyCode",
        line_number,
        f"{path}.currencyCode",
    )
    return EconomicsAmount(amount=amount, currency_code=currency_code)


__all__ = [
    "normalize_aggregated_detail",
    "normalize_properties",
    "optional_amount",
    "required_amount",
    "required_integral_numeric",
]
