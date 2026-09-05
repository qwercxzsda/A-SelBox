"""Seller namespace values shared by settlement persistence workflows."""

DEFAULT_SELLER_NAMESPACE: str = "__DEFAULT__"


def validate_seller_namespace(seller_namespace: str) -> str:
    """Return a normalized nonblank seller namespace."""
    normalized_namespace: str = seller_namespace.strip()
    if not normalized_namespace:
        raise ValueError("seller_namespace must not be blank.")
    return normalized_namespace
