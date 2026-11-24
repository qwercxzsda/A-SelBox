"""Prepare whole account-wide FBA reports. Each identical source row still counts."""

import csv
import io
import re
from collections import defaultdict
from collections.abc import Iterator, Mapping
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from ..amazon.datetimes import parse_amazon_datetime
from ..amazon.product_codes import validate_product
from ..source_serialization import content_sha256
from .periods import shift_months
from .taxes import marketplace_for_country, report_tax

REPORT_TYPES = {
    "STORAGE": "GET_FBA_STORAGE_FEE_CHARGES_DATA",
    "AGED_STORAGE": "GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA",
    "REMOVAL_ORDER": "GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA",
    "INVENTORY_LEDGER": "GET_LEDGER_SUMMARY_VIEW_DATA",
}

_REQUIRED = {
    "STORAGE": {
        "month_of_charge",
        "estimated_monthly_storage_fee",
        "asin",
        "fnsku",
        "country_code",
        "currency",
        "fulfillment_center",
    },
    "AGED_STORAGE": {
        "snapshot-date",
        "amount-charged",
        "country",
        "fnsku",
        "asin",
        "sku",
        "currency",
    },
    "REMOVAL_ORDER": {
        "request-date",
        "last-updated-date",
        "order-id",
        "order-type",
        "order-status",
        "sku",
        "fnsku",
        "removal-fee",
        "currency",
    },
    "INVENTORY_LEDGER": {"date", "fnsku", "asin", "msku", "location", "disposition"},
}


def _read_document(raw: bytes, source: str, scope: str) -> Iterator[dict[str, str]]:
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        if source != "AGED_STORAGE":
            raise ValueError("Expected a UTF-8 report.") from None
        decoded = raw.decode("cp932" if scope in {"JAPAN", "AUSTRALIA"} else "cp1252")
    reader = csv.reader(io.StringIO(decoded, newline=""), delimiter="\t", strict=True)
    headers = [c.strip().lower() for c in next(reader, list[str]())]
    if (
        not _REQUIRED[source].issubset(headers)
        or len(headers) != len(set(headers))
        or "" in headers
        or "\x00" in decoded
    ):
        raise ValueError("Report headers are missing or ambiguous.")
    for values in reader:
        if values:
            yield dict(zip(headers, values, strict=True))


def _month(value: date | datetime) -> str:
    return value.strftime("%Y-%m-01")


def _instant(value: str) -> datetime:
    return parse_amazon_datetime(value).astimezone(UTC)


def _ledger(r: dict[str, str]) -> tuple[str, dict[str, Any]]:
    if not re.fullmatch(r"(?:0[1-9]|1[0-2])/\d{4}", r["date"]):
        raise ValueError("Ledger rows must name a calendar month.")
    number, year = r["date"].split("/")
    month = date(int(year), int(number), 1).isoformat()
    validate_product(sku=r["msku"], asin=r["asin"], fnsku=r["fnsku"])
    if not r["location"] or not r["disposition"]:
        raise ValueError("Ledger rows must identify their location and condition.")
    return month[:7], {
        "month": month,
        "sku": r["msku"],
        "asin": r["asin"],
        "fnsku": r["fnsku"],
        "country_code": r["location"],
        "disposition": r["disposition"],
    }


def _storage(source: str, r: dict[str, str]) -> tuple[str, dict[str, Any]]:
    if source == "STORAGE":
        month = date.fromisoformat(r["month_of_charge"] + "-01").isoformat()
        key = month
        country = r["country_code"]
        fields = {"month_of_charge": month, "fulfillment_center": r["fulfillment_center"]}
    else:
        snapshot = _instant(r["snapshot-date"])
        key = _month(snapshot)
        month = _month(snapshot)
        country = r["country"]
        fields = {
            "snapshot_at": snapshot.isoformat(),
            "snapshot_month": month,
            "sku_printed": r["sku"],
            "condition": r.get("condition"),
            "age_tier": r.get("surcharge-age-tier"),
            "quantity_charged": r.get("qty-charged") or None,
        }
    validate_product(fnsku=r["fnsku"], asin=r["asin"], sku=r.get("sku"))
    market = marketplace_for_country(country)
    return key[:7], {
        "marketplace_name": market,
        "country_code": country,
        "asin": r["asin"],
        "ledger_first_month": month,
        "ledger_last_month": month,
        **fields,
    }


def _removal(r: dict[str, str]) -> tuple[str, dict[str, Any]]:
    start, end = _instant(r["request-date"]), _instant(r["last-updated-date"])
    if (
        end < start
        or not r["order-id"]
        or re.fullmatch(r"[0-9]{3}-[0-9]{7}-[0-9]{7}", r["order-id"])
        or r["order-type"] not in {"Disposal", "Return", "Liquidations"}
        or r["order-status"] not in {"Pending", "Completed", "Cancelled"}
    ):
        raise ValueError("Unrecognized removal order identity, status or date range.")
    validate_product(sku=r["sku"], fnsku=r["fnsku"])
    return r["order-id"], {
        "removal_order_id": r["order-id"],
        "requested_at": start.isoformat(),
        "last_updated_at": end.isoformat(),
        "ledger_first_month": _month(start),
        "ledger_last_month": _month(end),
        "sku_printed": r["sku"],
        "order_type": r["order-type"],
        "order_status": r["order-status"],
        "disposition": r.get("disposition"),
        **{
            k.replace("-", "_"): r.get(k) or None
            for k in (
                "requested-quantity",
                "cancelled-quantity",
                "disposed-quantity",
                "shipped-quantity",
                "in-process-quantity",
            )
        },
    }


def _money_row(
    source: str, scope: str, r: dict[str, str], currency_decimals: Mapping[str, int]
) -> tuple[str, dict[str, Any]]:
    key, row = _removal(r) if source == "REMOVAL_ORDER" else _storage(source, r)
    field = {
        "STORAGE": "estimated_monthly_storage_fee",
        "AGED_STORAGE": "amount-charged",
        "REMOVAL_ORDER": "removal-fee",
    }[source]
    try:
        amount = Decimal(r[field] or "0") if source == "REMOVAL_ORDER" else Decimal(r[field])
    except InvalidOperation:
        raise ValueError("Report amount must be decimal.") from None
    currency = r["currency"] or None
    if (
        not amount.is_finite()
        or (currency is None and (source != "REMOVAL_ORDER" or amount))
        or (currency and not re.fullmatch("[A-Z]{3}", currency))
    ):
        raise ValueError("Invalid report currency or amount.")
    base, tax = report_tax(
        scope, source, row.get("country_code"), currency, amount, currency_decimals
    )
    printed = Decimal(r[field]) if r[field] else None
    row.update(
        fnsku=r["fnsku"],
        currency=currency,
        fee_amount=printed,
        base_amount=base if printed is not None else None,
        tax_amount=tax if printed is not None else None,
    )
    return key, row


def prepare_report(
    source: str,
    raw: bytes,
    scope: str,
    start: date,
    end: date,
    currency_decimals: Mapping[str, int],
    *,
    cancelled: bool = False,
    positions: dict[str, int] | None = None,
    captured_at: datetime | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Prepare a complete answer for [start, end), retaining empty months and duplicates."""
    if start >= end or source not in REPORT_TYPES:
        raise ValueError("Expected a known report and a nonempty period.")
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if source != "REMOVAL_ORDER":
        if start.day != 1 or end.day != 1:
            raise ValueError("Monthly reports require full months.")
        month = start
        while month < end:
            groups[month.strftime("%Y-%m")] = []
            month = shift_months(month, 1)
    if cancelled:
        if raw:
            raise ValueError("An empty cancelled report cannot carry a document.")
        return groups
    dates: dict[str, date] = {}
    for position, original in enumerate(_read_document(raw, source, scope), 1):
        key, row = (
            _ledger(original)
            if source == "INVENTORY_LEDGER"
            else _money_row(source, scope, original, currency_decimals)
        )
        if source == "REMOVAL_ORDER":
            seen = datetime.fromisoformat(row["requested_at"])
            if (
                dates.setdefault(key, seen) != seen
                or not start <= seen.date() < end
                or (captured_at is not None and seen >= captured_at)
            ):
                raise ValueError(
                    "Removal order request dates disagree or lie outside the requested period."
                )
        elif key not in groups:
            raise ValueError("Report row lies outside its requested period.")
        if source == "AGED_STORAGE":
            day = datetime.fromisoformat(row["snapshot_at"]).date()
            if dates.setdefault(key, day) != day:
                raise ValueError("An aged storage month cannot contain two snapshot days.")
        if positions is not None:
            positions.setdefault(key, position)
        groups[key].append(row)
    for rows in groups.values():
        rows.sort(key=content_sha256)
    return groups
