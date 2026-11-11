"""Strict native JSON values and account identities for Finances."""

import json
import re
from collections.abc import Mapping
from datetime import datetime
from decimal import Decimal
from typing import cast

from ..amazon.datetimes import as_utc
from ..amazon.finances.client import FinancesOperation
from ..numeric import Numeric

ACCOUNT_TYPES = {
    "Standard Orders": "STANDARD_ORDERS",
    "Invoiced Orders": "INVOICED_ORDERS",
    "STANDARD_ORDERS": "STANDARD_ORDERS",
    "INVOICED_ORDERS": "INVOICED_ORDERS",
}


def object_value(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise TypeError("Finances object is required.")
    return cast(Mapping[str, object], value)


def array(value: object) -> tuple[object, ...]:
    if value is None:
        return ()
    if not isinstance(value, list | tuple):
        raise TypeError("Finances array is required.")
    return tuple(cast(list[object] | tuple[object, ...], value))


def text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Finances nonblank text is required.")
    return value


def timestamp(value: object) -> datetime:
    return as_utc(datetime.fromisoformat(text(value)))


def account_type(value: object) -> str:
    try:
        return ACCOUNT_TYPES[text(value)]
    except KeyError:
        raise ValueError("Unsupported Finances account type.") from None


def money(value: object) -> tuple[Numeric, str]:
    obj = object_value(value)
    currency = text(obj.get("currencyCode"))
    if re.fullmatch("[A-Z]{3}", currency) is None:
        raise ValueError("Finances currency must be an ISO currency code.")
    return Numeric(obj["currencyAmount"]), currency


def decode_page(body: bytes, operation: FinancesOperation) -> Mapping[str, object]:
    """Read the same native envelope during acquisition and offline preprocessing."""
    raw: object = json.loads(body, parse_float=Decimal, parse_int=int)
    obj = object_value(raw)
    if obj.get("errors"):
        raise ValueError("Failed Finances response cannot establish coverage.")
    # Summary's published model is direct-root; live responses also use payload.
    payload = object_value(
        obj.get("payload", obj) if operation == "summary" else obj.get("payload")
    )
    key = "transactions" if operation == "transactions" else "summaries"
    if not isinstance(payload.get(key), list):
        raise ValueError("Finances response is missing its record inventory.")
    return payload


def continuation_token(payload: Mapping[str, object]) -> str | None:
    token = payload.get("nextToken")
    if token is not None and (not isinstance(token, str) or not token.strip()):
        raise ValueError("Finances continuation token must be nonempty text or null.")
    return token


def related_ids(value: object) -> dict[str, str]:
    result: dict[str, str] = {}
    for entry in array(value):
        obj = object_value(entry)
        name = text(obj.get("relatedIdentifierName"))
        if obj.get("relatedIdentifierValue") in (None, "") and name not in {
            "DEFERRED_TRANSACTION_ID",
            "RELEASE_TRANSACTION_ID",
        }:
            # Amazon emits empty optional ORDER_ID on some direct service charges.
            # The original entry remains available in the archived response page.
            continue
        identifier = text(obj.get("relatedIdentifierValue"))
        if name in result and result[name] != identifier:
            raise ValueError("Conflicting Finances related identifiers.")
        result[name] = identifier
    return result
