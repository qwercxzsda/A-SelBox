"""Pure Amazon provenance-scope names shared by API and database workflows."""

AMAZON_SCOPES: tuple[str, ...] = (
    "NA",
    "EU",
    "JAPAN",
    "SINGAPORE",
    "AUSTRALIA",
)
DEFAULT_AMAZON_SCOPE = "NA"


def validate_amazon_scope(scope: str) -> str:
    """Validate an exact named refresh-token and persistence scope."""
    if scope not in AMAZON_SCOPES:
        raise ValueError(
            f"Unsupported Amazon scope: {scope}. "
            f"Expected exact one of {', '.join(sorted(AMAZON_SCOPES))}."
        )
    return scope


__all__ = [
    "AMAZON_SCOPES",
    "DEFAULT_AMAZON_SCOPE",
    "validate_amazon_scope",
]
