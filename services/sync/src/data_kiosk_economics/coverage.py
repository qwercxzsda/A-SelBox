"""Verify every selected field in the pinned query is represented in the response."""

from collections.abc import Mapping, Sequence
from typing import cast

from ..amazon.data_kiosk.economics_source_parsing import ParsedEconomicsDocuments

# Null is accepted by the schema where applicable; omission is not evidence of
# a null value. Unexpected fields need a new preprocessor definition.
_MONEY = frozenset({"amount", "currencyCode"})
_DETAIL = frozenset(
    {
        "amount",
        "amountPerUnit",
        "amountPerUnitDelta",
        "promotionAmount",
        "quantity",
        "taxAmount",
        "totalAmount",
    }
)
_ROOT = frozenset(
    {
        "startDate",
        "endDate",
        "marketplaceId",
        "msku",
        "childAsin",
        "fnsku",
        "parentAsin",
        "sales",
        "fees",
        "ads",
        "cost",
        "netProceeds",
    }
)
_SALES = frozenset(
    {
        "averageSellingPrice",
        "netProductSales",
        "netUnitsSold",
        "orderedProductSales",
        "refundedProductSales",
        "unitsOrdered",
        "unitsRefunded",
    }
)


def validate_requested_fields(parsed: ParsedEconomicsDocuments) -> None:
    """Validate the complete pinned selection before nullable values are normalized."""
    for page in parsed.pages:
        if page.parsed_document is None:
            continue
        for source in page.parsed_document.rows:
            try:
                _validate_row(source.value)
            except ValueError as error:
                error.add_note(
                    f"Data Kiosk source_document_id={page.document_id}; "
                    f"source_line={source.source_line_number}."
                )
                raise


def _validate_row(value: Mapping[str, object]) -> None:
    row = _fields(value, _ROOT)
    sales = _fields(row["sales"], _SALES)
    for key in {
        "averageSellingPrice",
        "netProductSales",
        "orderedProductSales",
        "refundedProductSales",
    }:
        _nullable_money(sales[key])
    for item in _array(row["fees"]):
        fee = _fields(item, frozenset({"feeTypeName", "charges"}))
        for charge in _array(fee["charges"]):
            _validate_fee_charge(charge)
    for item in _array(row["ads"]):
        ad = _fields(item, frozenset({"adTypeName", "charge"}))
        if ad["charge"] is not None:
            _detail(ad["charge"])
    _validate_cost(row["cost"])
    for amount in _fields(row["netProceeds"], frozenset({"perUnit", "total"})).values():
        _nullable_money(amount)


def _validate_fee_charge(value: object) -> None:
    charge = _fields(
        value,
        frozenset(
            {
                "identifier",
                "startDate",
                "endDate",
                "properties",
                "aggregatedDetail",
                "components",
            }
        ),
    )
    _detail(charge["aggregatedDetail"])
    _properties(charge["properties"])
    for item in _array(charge["components"]):
        component = _fields(item, frozenset({"name", "properties", "aggregatedDetail"}))
        _detail(component["aggregatedDetail"])
        _properties(component["properties"])


def _validate_cost(value: object) -> None:
    if value is None:
        return
    cost = _fields(value, frozenset({"costOfGoodsSold", "fbaCost", "mfnCost", "miscellaneousCost"}))
    _nullable_money(cost["costOfGoodsSold"])
    _nullable_money(cost["miscellaneousCost"])
    for key, expected in (
        ("fbaCost", frozenset({"shippingToAmazonCost"})),
        ("mfnCost", frozenset({"fulfillmentCost", "storageCost"})),
    ):
        if cost[key] is not None:
            for amount in _fields(cost[key], expected).values():
                _nullable_money(amount)


def _fields(value: object, expected: frozenset[str]) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError("Data Kiosk selected fields must be an object.")
    mapping = cast(Mapping[str, object], value)
    if frozenset(mapping) != expected:
        raise ValueError("Data Kiosk response omits or adds fields from its complete pinned query.")
    return mapping


def _array(value: object) -> Sequence[object]:
    if value is None:
        return ()
    if not isinstance(value, tuple | list):
        raise ValueError("Data Kiosk selected collection must be an array or null.")
    return cast(Sequence[object], value)


def _nullable_money(value: object) -> None:
    if value is not None:
        _fields(value, _MONEY)


def _detail(value: object) -> None:
    detail = _fields(value, _DETAIL)
    for key in _DETAIL - {"quantity"}:
        _nullable_money(detail[key])


def _properties(value: object) -> None:
    for item in _array(value):
        _fields(item, frozenset({"propertyName", "propertyValue"}))
