"""Stable seller identity shared by acquisition and financial reads."""

DEFAULT_SELLER_NAMESPACE: str = "__DEFAULT__"


def validate_seller_namespace(seller_namespace: object) -> str:
    """Return a normalized nonblank seller namespace."""
    if not isinstance(seller_namespace, str) or not seller_namespace.strip():
        raise ValueError("seller_namespace must be non-empty text.")
    return seller_namespace.strip()
