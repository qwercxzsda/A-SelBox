"""Stable seller identity shared by acquisition, ownership, and financial reads."""

from .values import required_text

DEFAULT_SELLER_NAMESPACE: str = "__DEFAULT__"


def validate_seller_namespace(seller_namespace: str) -> str:
    """Return a normalized nonblank seller namespace."""
    return required_text(seller_namespace, "seller_namespace")
