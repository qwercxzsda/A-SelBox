"""Checked fee rates and the tax treatments printed by Amazon's warehouse reports."""

from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal

from .currencies import currency_unit

ZERO = Decimal(0)
TEN = Decimal("0.10")
SEVEN = Decimal("0.07")
NINE = Decimal("0.09")

COUNTRY_MARKETPLACES = {
    "US": "Amazon.com",
    "CA": "Amazon.ca",
    "GB": "Amazon.co.uk",
    "DE": "Amazon.de",
    "FR": "Amazon.fr",
    "IT": "Amazon.it",
    "ES": "Amazon.es",
    "JP": "Amazon.co.jp",
    "AU": "Amazon.com.au",
    "SG": "Amazon.sg",
    "BE": "Amazon.com.be",
    "SE": "Amazon.se",
    "PL": "Amazon.pl",
    "NL": "Amazon.nl",
    "IE": "Amazon.ie",
}

# The first rate is the one a warehouse report applies with the facts it contains.
_FEE_COUNTRIES = {
    "STORAGE_FEES": ("US GB DE FR IT ES CA", "JP AU", "SG", ""),
    "AGED_STORAGE_FEES": ("US GB DE CA", "JP AU", "SG", ""),
    "DISPOSAL_FEES": ("GB US DE ES FR CA", "JP AU", "SG", ""),
    "CUSTOMER_RETURN_DISPOSAL": ("US GB DE ES IT", "", "", "CA"),
    "REMOVAL_FEES": ("US GB", "JP", "", ""),
    "LABELING_FEES": ("", "JP", "", ""),
    "INBOUND_PLACEMENT_FEES": ("US", "", "", ""),
    "INBOUND_TRANSPORTATION_FEES": ("DE US GB FR", "", "", ""),
    "INBOUND_TRANSPORTATION_PROGRAM_FEES": ("DE GB", "", "", ""),
    "INBOUND_DEFECT_FEES": ("GB", "", "", ""),
    "ADVERTISING": ("US GB JP FR DE IT BE SE ES PL NL IE", "AU SG", "", ""),
    "COUPON_FEES": ("US CA", "", "", ""),
    "DEAL_FEES": ("FR GB IT DE JP US ES", "", "", ""),
}

_RATES = {
    (fee, COUNTRY_MARKETPLACES[country]): rate
    for fee, groups in _FEE_COUNTRIES.items()
    for group, rate in zip(groups, (ZERO, TEN, NINE, SEVEN), strict=True)
    for country in group.split()
}

_REPORT_COUNTRIES = {"US", "CA", "GB", "DE", "FR", "IT", "ES", "JP", "AU", "SG"}
_REMOVAL_CURRENCIES = {
    "JAPAN": {"JPY"},
    "AUSTRALIA": {"AUD"},
    "NA": {"USD", "CAD"},
    "EU": {"EUR", "GBP"},
    "SINGAPORE": {"SGD"},
}


def finance_rate(
    marketplace_name: str, component_type: str, customer_order: bool = False
) -> Decimal:
    kind = (
        "CUSTOMER_RETURN_DISPOSAL"
        if component_type == "DISPOSAL_FEES" and customer_order
        else component_type
    )
    try:
        return _RATES[kind, marketplace_name]
    except KeyError:
        raise ValueError("No observed tax rule for this marketplace and fee.") from None


def marketplace_for_country(country: str) -> str:
    if country not in _REPORT_COUNTRIES:
        raise ValueError("Unknown warehouse fee report country.")
    return COUNTRY_MARKETPLACES[country]


def report_tax(
    scope: str,
    source: str,
    country: str | None,
    currency: str | None,
    amount: Decimal,
    currency_decimals: Mapping[str, int],
) -> tuple[Decimal, Decimal]:
    unit = currency_unit(currency, currency_decimals) if currency else None
    if not amount:
        return ZERO, ZERO
    if unit is None:
        raise ValueError("A warehouse charge requires a currency.")
    if source == "REMOVAL_ORDER":
        if currency not in _REMOVAL_CURRENCIES[scope]:
            raise ValueError("Unknown removal report seller account and currency pair.")
        rate = {"JAPAN": TEN, "AUSTRALIA": TEN, "SINGAPORE": NINE}.get(scope, ZERO)
        included = True
    else:
        if country is None:
            raise ValueError("A storage report must name a country.")
        if (
            source == "AGED_STORAGE"
            and country == "SG"
            and (scope, currency) != ("SINGAPORE", "SGD")
        ):
            raise ValueError("Unknown Singapore aged storage account and currency pair.")
        kind = {"STORAGE": "STORAGE_FEES", "AGED_STORAGE": "AGED_STORAGE_FEES"}[source]
        rate = finance_rate(marketplace_for_country(country), kind)
        included = source == "AGED_STORAGE" and country == "JP"
    tax = (amount * rate / (1 + rate if included else 1)).quantize(unit, rounding=ROUND_HALF_UP)
    return amount - tax if included else amount, tax
