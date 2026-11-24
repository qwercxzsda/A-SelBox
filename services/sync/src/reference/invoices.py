"""Normalize an Ads invoice without counting the regulatory fee twice."""

from collections.abc import Mapping
from datetime import date
from decimal import Decimal

from ..finances.values import array, object_value, text
from ..numeric import Numeric
from .currencies import currency_unit

AD_PROGRAMS = {
    "SPONSORED PRODUCTS": "SPONSORED_PRODUCTS",
    "SPONSORED BRANDS": "SPONSORED_BRANDS",
    "SPONSORED DISPLAY": "SPONSORED_DISPLAY",
    "SELF SERVICE PERFORMANCE ADS ON TV": "SPONSORED_TV",
}
ACCOUNT_ADJUSTMENTS = {
    "Applying Over Delivery Click Credits": "OVER_DELIVERY_CLICK_CREDITS",
    "Rounding Adjustment": "ROUNDING",
}
CAMPAIGN_ADJUSTMENT = "Over Delivery Adjustment Applied Against Campaign: "


def identifier(value: object) -> str:
    if type(value) is int:
        return str(value)
    return text(value)


def _money(value: object, currency: str) -> Decimal:
    money = object_value(value)
    if money.get("currencyCode") != currency:
        raise ValueError("Mixed currencies in an advertising invoice.")
    return Numeric(money["amount"]).value


def invoice_rows(
    invoice: Mapping[str, object],
    native_id: str,
    profile_id: str,
    currency_decimals: Mapping[str, int],
) -> dict[str, object]:
    summary = object_value(invoice["invoiceSummary"])
    if identifier(summary["id"]) != native_id:
        raise ValueError("Invoice response differs from the requested invoice.")
    if array(invoice["promotions"]):
        raise ValueError("Unsupported advertising invoice promotion.")
    currency = text(object_value(summary["amountDue"])["currencyCode"])
    rate = Numeric(summary["taxRate"]).value
    if rate not in (0, 10, 1000):
        raise ValueError("Unsupported advertising invoice tax rate.")
    multiplier = Decimal("0.10") if rate else Decimal(0)
    currency_unit(currency, currency_decimals)
    rows: list[dict[str, object]] = []
    names: dict[str, list[dict[str, object]]] = {}
    for item in array(invoice["invoiceLines"]):
        line = object_value(item)
        program = text(line.get("programName"))
        if program not in AD_PROGRAMS:
            raise ValueError("Unrecognized advertising invoice program.")
        row: dict[str, object] = {
            "line_kind": "CAMPAIGN",
            "campaign_id": identifier(line.get("campaignId")),
            "campaign_aid": identifier(line["campaignAID"]) if line.get("campaignAID") else None,
            "campaign_name": text(line.get("campaignName")),
            "ad_program": AD_PROGRAMS[program],
            "cost_amount": _money(line["cost"], currency),
        }
        rows.append(row)
        names.setdefault(text(row["campaign_name"]), []).append(row)
    for item in array(invoice["adjustments"]):
        adj = object_value(item)
        desc = text(adj["description"])
        adjustment: dict[str, object] = {
            "description": desc,
            "cost_amount": _money(adj["amount"], currency),
        }
        if desc in ACCOUNT_ADJUSTMENTS:
            adjustment.update(
                line_kind="ACCOUNT_ADJUSTMENT", adjustment_kind=ACCOUNT_ADJUSTMENTS[desc]
            )
        elif desc.startswith(CAMPAIGN_ADJUSTMENT):
            matches = names.get(desc.removeprefix(CAMPAIGN_ADJUSTMENT), [])
            if len(matches) != 1:
                raise ValueError("Named invoice adjustment requires one matching campaign line.")
            source = matches[0]
            adjustment.update(
                line_kind="CAMPAIGN_ADJUSTMENT", adjustment_kind="OVER_DELIVERY_AGAINST_CAMPAIGN"
            )
            for key in ("campaign_id", "campaign_aid", "campaign_name"):
                adjustment[key] = source[key]
        else:
            raise ValueError("Unrecognized advertising adjustment.")
        rows.append(adjustment)
    for row in rows:
        row["base_amount"] = row["cost_amount"]
        row["tax_amount"] = Numeric(row["cost_amount"]).value * multiplier
    details = object_value(invoice["taxDetail"])
    taxes = [object_value(t) for t in array(details["taxBreakups"])]
    applied = [t for t in taxes if Numeric(t["taxRate"]).value == rate]
    tax_names = {text(t["taxName"]) for t in applied}
    countries = {
        text(t["taxedJurisdictionName"]) for t in applied if t.get("taxedJurisdictionName")
    }
    return {
        "invoice_id": native_id,
        "profile_id": profile_id,
        "tax_name": next(iter(tax_names)) if len(tax_names) == 1 else None,
        "tax_country": next(iter(countries)) if len(countries) == 1 else None,
        "tax_rate_stated": rate,
        "tax_rate_percent": multiplier * 100,
        "line_count": len(rows),
        "currency": currency,
        "invoice_status": text(summary["status"]),
        "invoice_date": date.fromisoformat(text(summary["invoiceDate"])),
        "from_date": date.fromisoformat(text(summary["fromDate"])),
        "to_date": date.fromisoformat(text(summary["toDate"])),
        "amount_due": _money(summary["amountDue"], currency),
        "tax_amount_due": _money(summary["taxAmountDue"], currency),
        "rows": rows,
    }
