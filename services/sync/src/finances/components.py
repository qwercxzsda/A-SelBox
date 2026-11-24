"""Normalize exactly one complete monetary partition per native transaction."""

from collections.abc import Iterator, Mapping
from decimal import Decimal

from ..numeric import ZERO, Numeric
from ..reference.currencies import currency_unit
from ..reference.taxes import finance_rate
from ..transaction_types.finances import classify_finances_component, classify_zero_component
from .marketplaces import financial_marketplace_name, financial_marketplace_timezone
from .models import FinancesComponent
from .routing import amount_part, charge_route, context
from .values import array, money, object_value, related_ids, text, timestamp


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


def _product(item: Mapping[str, object]) -> tuple[str | None, str | None, Numeric | None]:
    product = context(item, "ProductContext")
    sku = text(product["sku"]) if product.get("sku") else None
    asin = text(product["asin"]) if product.get("asin") else None
    raw_quantity = product.get("quantityShipped")
    quantity = None if raw_quantity is None else Numeric(raw_quantity)
    if quantity is not None and quantity < ZERO:
        raise ValueError("Finances shipped quantity must be nonnegative.")
    return sku, asin, quantity


def build_components(
    transaction: Mapping[str, object], currency_decimals: Mapping[str, int]
) -> tuple[FinancesComponent, ...]:
    kind = text(transaction.get("transactionType"))
    total, currency = money(transaction.get("totalAmount"))
    unit = currency_unit(currency, currency_decimals)
    market = text(object_value(transaction.get("sellingPartnerMetadata")).get("marketplaceId"))
    name = financial_marketplace_name(market)
    zone = financial_marketplace_timezone(market)
    posted = timestamp(transaction.get("postedDate")).astimezone(zone).date()
    links = related_ids(transaction.get("relatedIdentifiers"))
    items = tuple(object_value(i) for i in array(transaction.get("items")))
    # Items and transaction breakdowns are alternative partitions, never additive.
    sources = items or (transaction,)
    result: list[FinancesComponent] = []
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
        sku, asin, quantity = _product(item)
        leaves = tuple(_leaves(item.get("breakdowns"), currency))
        if not leaves:
            if item_total != ZERO:
                raise ValueError("Finances monetary detail is missing.")
            leaves = (((), (), ZERO),)
        if sum((leaf[2] for leaf in leaves), ZERO) != item_total:
            raise ValueError("Finances item components do not equal the native amount.")
        liquidation = any(path == ("RecommerceLiquidation",) for path, _, _ in leaves)
        costs: dict[tuple[str, bool], list[Numeric]] = {}
        for path, indexes, amount in leaves:
            definition = (
                classify_finances_component(kind, path)
                if path
                else classify_zero_component(kind, transaction.get("description"))
            )
            route = charge_route(
                definition,
                item,
                links,
                transaction_type=kind,
                liquidation=liquidation,
                sku=sku,
                asin=asin,
                posted=posted,
                zone=zone,
            )
            part = amount_part(definition.component_type, path)
            if route.name not in {"SKU", "FNSKU", "ASIN", "SELBOX"}:
                bucket = costs.setdefault(
                    (definition.component_type, route.name == "CUSTOMER_ORDER"), [ZERO, ZERO]
                )
                bucket[int(part == "TAX")] += amount
            fee_base = (
                amount
                if definition.component_type in {"PRODUCT_SALES", "PRODUCT_REFUNDS"}
                else None
            )
            result.append(
                FinancesComponent(
                    len(result) + 1,
                    "PRODUCT_TAX"
                    if liquidation and definition.component_type == "TAX_RECLASSIFICATION"
                    else definition.component_type,
                    sku if route.name == "SKU" else None,
                    amount,
                    quantity if fee_base is not None else None,
                    fee_base,
                    None if liquidation else definition.selbox_group,
                    path,
                    item_index,
                    indexes,
                    route.name,
                    part,
                    asin,
                    sku if liquidation else None,
                    route.reference_id,
                    route.reference_month,
                    route.ledger_start,
                    route.ledger_end,
                )
            )
        for (component_type, customer_order), (base, tax) in costs.items():
            if base == ZERO:
                if tax != ZERO:
                    raise ValueError("A zero cost charge cannot carry tax.")
                continue
            rate = finance_rate(name, component_type, customer_order=customer_order)
            tolerance = max(unit, abs(base.value) * Decimal("0.002"))
            if (rate == 0 and tax != ZERO) or abs(tax.value - base.value * rate) > tolerance:
                raise ValueError(
                    "Finances charge tax differs from its observed market and fee rule."
                )
    if sum((r.amount for r in result), ZERO) != total:
        raise ValueError("Finances items do not equal the transaction control total.")
    return tuple(result)
