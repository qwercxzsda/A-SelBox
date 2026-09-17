"""Normalize the explicitly declared source scope shared by financial readers."""

from collections.abc import Sequence
from datetime import date

from ..amazon.marketplace_names import validate_marketplace_name
from .seller_namespaces import validate_seller_namespace
from .values import normalize_uuid, required_date, required_text


def financial_scope_parameters(
    *,
    seller_namespace: str,
    start_date: date,
    end_date: date,
    preprocess_version: str,
    settlement_ids: Sequence[str],
    marketplace_names: Sequence[str],
    dataset_key: str,
) -> dict[str, object]:
    """Keep canonical settlements and Data Kiosk day coverage explicit and distinct."""
    required_date(start_date, "start_date")
    required_date(end_date, "end_date")
    if start_date > end_date:
        raise ValueError("The financial date interval must not be inverted.")
    if dataset_key != "economics":
        raise ValueError("Financial calculations require the economics dataset.")
    return {
        "seller_namespace": validate_seller_namespace(seller_namespace),
        "start_date": start_date,
        "end_date": end_date,
        "preprocess_version": required_text(preprocess_version, "preprocess_version"),
        "settlement_ids": sorted(
            {normalize_uuid(identifier, "settlement_id") for identifier in settlement_ids}
        ),
        "marketplace_names": sorted(
            {validate_marketplace_name(name) for name in marketplace_names}
        ),
        "dataset_key": dataset_key,
    }
