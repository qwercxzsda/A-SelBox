from sp_api.base import Marketplaces

# SP-API endpoints are regional, but report queries still need marketplace IDs.
ENDPOINT_MARKETPLACES: dict[str, list[Marketplaces]] = {
    "NA": [Marketplaces.US, Marketplaces.CA, Marketplaces.MX, Marketplaces.BR],
    "EU": [
        Marketplaces.AE,
        Marketplaces.BE,
        Marketplaces.DE,
        Marketplaces.EG,
        Marketplaces.ES,
        Marketplaces.FR,
        Marketplaces.GB,
        Marketplaces.IE,
        Marketplaces.IN,
        Marketplaces.IT,
        Marketplaces.NL,
        Marketplaces.PL,
        Marketplaces.SA,
        Marketplaces.SE,
        Marketplaces.TR,
        Marketplaces.ZA,
    ],
    "FE": [Marketplaces.AU, Marketplaces.JP, Marketplaces.SG],
}


def validate_endpoint(endpoint: str) -> str:
    """Validate an exact Amazon regional endpoint code."""
    if endpoint not in ENDPOINT_MARKETPLACES:
        raise ValueError(
            f"Unsupported amazon endpoint: {endpoint}. "
            f"Expected exact one of {', '.join(sorted(ENDPOINT_MARKETPLACES))}."
        )
    return endpoint


def get_endpoint_marketplaces(endpoint: str) -> list[Marketplaces]:
    """Return all marketplaces searched for a regional endpoint."""
    return ENDPOINT_MARKETPLACES[validate_endpoint(endpoint)]
