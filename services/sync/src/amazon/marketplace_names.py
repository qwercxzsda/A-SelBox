"""Fixed marketplace names shared by source facts and live fee configuration."""

MARKETPLACE_NAME_BY_ID: dict[str, str] = {
    "ATVPDKIKX0DER": "Amazon.com",
    "A2EUQ1WTGCTBG2": "Amazon.ca",
    "A1AM78C64UM0Y8": "Amazon.com.mx",
    "A2Q3Y263D00KWC": "Amazon.com.br",
    "A1F83G8C2ARO7P": "Amazon.co.uk",
    "A1PA6795UKMFR9": "Amazon.de",
    "A13V1IB3VIYZZH": "Amazon.fr",
    "APJ6JRA9NG5V4": "Amazon.it",
    "A1RKKUPIHCS9HS": "Amazon.es",
    "A1805IZSGTT6HS": "Amazon.nl",
    "A2NODRKZP88ZB9": "Amazon.se",
    "A1C3SOZRARQ6R3": "Amazon.pl",
    "AMEN7PMS3EDWL": "Amazon.com.be",
    "A28R8C7NBKEWEA": "Amazon.ie",
    "A33AVAJ2PDY3EV": "Amazon.com.tr",
    "A21TJRUUN4KGV": "Amazon.in",
    "A2VIGQ35RCS4UG": "Amazon.ae",
    "A17E79C6D8DWNP": "Amazon.sa",
    "ARBP9OOSHTCHU": "Amazon.eg",
    "AE08WJ6YKNBMC": "Amazon.co.za",
    "A1VC38T7YXB528": "Amazon.co.jp",
    "A39IBJ37TRP1C6": "Amazon.com.au",
    "A19VAU5U5O7RUS": "Amazon.sg",
}
MARKETPLACE_NAMES: frozenset[str] = frozenset((*MARKETPLACE_NAME_BY_ID.values(), "Non-Amazon US"))


def validate_marketplace_name(value: str) -> str:
    """Require an explicit canonical name without aliasing or inventing a value."""
    if value not in MARKETPLACE_NAMES:
        raise ValueError(f"Unsupported canonical marketplace name: {value!r}.")
    return value


def marketplace_name_from_id(marketplace_id: str) -> str:
    """Map a validated source ID locally, without a Sellers API request."""
    try:
        return MARKETPLACE_NAME_BY_ID[marketplace_id]
    except KeyError:
        raise ValueError(f"Unsupported Amazon marketplace ID: {marketplace_id!r}.") from None
