"""Normalize exactly one complete monetary partition per native transaction."""

from collections import Counter
from collections.abc import Iterator, Mapping

from ..allocation import AllocationCategory
from ..numeric import ZERO, Numeric
from ..source_serialization import content_sha256
from ..transaction_types.finances import classify_finances_component, classify_zero_component
from .models import FinancesComponent
from .values import array, money, object_value, text


def _leaves(
    values: object, currency: str, path: tuple[str, ...] = (), indexes: tuple[int, ...] = ()
) -> Iterator[tuple[tuple[str, ...], tuple[int, ...], Numeric]]:
    for index, value in enumerate(array(values)):
        obj = object_value(value)
        amount, code = money(obj.get("breakdownAmount"))
        if code != currency:
            raise ValueError("Finances breakdown currency differs from its transaction.")
        current_path = (*path, text(obj.get("breakdownType")))
        current_indexes = (*indexes, index)
        children = array(obj.get("breakdowns"))
        if children:
            leaves = tuple(_leaves(children, currency, current_path, current_indexes))
            if sum((leaf[2] for leaf in leaves), ZERO) != amount:
                raise ValueError("Finances child amounts do not equal their parent.")
            yield from leaves
        else:
            yield current_path, current_indexes, amount


def _product(item: Mapping[str, object]) -> tuple[str | None, Numeric | None]:
    contexts = [object_value(c) for c in array(item.get("contexts"))]
    products = [c for c in contexts if c.get("contextType") == "ProductContext"]
    if len(products) > 1:
        raise ValueError("Ambiguous Finances item product context.")
    if not products:
        return None, None
    product = products[0]
    raw_sku = product.get("sku")
    sku = None if raw_sku is None or raw_sku == "" else text(raw_sku)
    raw_quantity = product.get("quantityShipped")
    quantity = None if raw_quantity is None else Numeric(raw_quantity)
    if quantity is not None and quantity < ZERO:
        raise ValueError("Finances shipped quantity must be nonnegative.")
    return sku, quantity


def build_components(transaction: Mapping[str, object]) -> tuple[FinancesComponent, ...]:
    identifier = text(transaction.get("transactionId"))
    kind = text(transaction.get("transactionType"))
    total, currency = money(transaction.get("totalAmount"))
    items = tuple(object_value(i) for i in array(transaction.get("items")))
    # Items and transaction breakdowns are alternative partitions, never additive.
    sources = items or (transaction,)
    result: list[FinancesComponent] = []
    occurrences: Counter[str] = Counter()
    for item_index, item in enumerate(sources):
        item_money = object_value(item.get("totalAmount"))
        implicit_zero_currency = (
            item_money.get("currencyCode") is None
            and Numeric(item_money.get("currencyAmount")) == ZERO
            and not array(item.get("breakdowns"))
        )
        item_total, item_currency = (
            (ZERO, currency) if implicit_zero_currency else money(item_money)
        )
        if item_currency != currency:
            raise ValueError("Finances item currency differs from its transaction.")
        sku, quantity = _product(item)
        leaves = tuple(_leaves(item.get("breakdowns"), currency))
        if not leaves:
            if item_total != ZERO:
                raise ValueError("Finances monetary detail is missing.")
            leaves = (((), (), ZERO),)
        if sum((leaf[2] for leaf in leaves), ZERO) != item_total:
            raise ValueError("Finances item components do not equal the native amount.")
        for path, indexes, amount in leaves:
            definition = (
                classify_finances_component(kind, path)
                if path
                else classify_zero_component(kind, transaction.get("description"))
            )
            if definition.category is AllocationCategory.FINANCES and sku is None:
                raise ValueError("Allocated Finances component lacks a source SKU.")
            fee_base = (
                amount
                if definition.component_type in {"PRODUCT_SALES", "PRODUCT_REFUNDS"}
                else None
            )
            source_fields: dict[str, object] = {
                "item_index": item_index,
                "breakdown_path": list(path),
                "breakdown_indexes": list(indexes),
                "item_related_identifiers": item.get("relatedIdentifiers", []),
                "currency_from_transaction_zero_item": implicit_zero_currency,
            }
            identity = content_sha256(
                {
                    "transaction": identifier,
                    "sku": sku,
                    "path": path,
                    "amount": amount,
                    "quantity": quantity,
                    "item_identifiers": sorted(
                        content_sha256(value) for value in array(item.get("relatedIdentifiers"))
                    ),
                }
            )
            occurrences[identity] += 1
            key = f"{identity}:{occurrences[identity]}"
            result.append(
                FinancesComponent(
                    key,
                    definition.category,
                    definition.component_type,
                    sku,
                    amount,
                    currency,
                    quantity if fee_base is not None else None,
                    fee_base,
                    definition.accounting_subtype,
                    source_fields,
                )
            )
    if sum((r.amount for r in result), ZERO) != total:
        raise ValueError("Finances items do not equal the transaction control total.")
    return tuple(result)
