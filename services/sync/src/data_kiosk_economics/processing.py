"""Assemble one complete in-memory Data Kiosk provision batch."""

from collections.abc import Sequence
from datetime import datetime

from ..database.data_kiosk_economics.models import DataKioskProvisionRefresh
from .acquisition import MarketplaceProvisionData


def build_data_kiosk_provision_refresh(
    marketplace_data: Sequence[MarketplaceProvisionData],
    *,
    seller_namespace: str,
    amazon_scope: str,
    refreshed_at: datetime,
    covered_marketplace_ids: Sequence[str] | None = None,
) -> DataKioskProvisionRefresh:
    """Combine successful results and the marketplaces covered by their batch."""
    results = tuple(marketplace_data)
    result_marketplace_ids = tuple(result.marketplace_id for result in results)
    if not results or len(result_marketplace_ids) != len(set(result_marketplace_ids)):
        raise ValueError("Provision refresh results must contain unique marketplaces.")
    marketplace_ids = (
        result_marketplace_ids
        if covered_marketplace_ids is None
        else tuple(covered_marketplace_ids)
    )
    if not set(result_marketplace_ids).issubset(marketplace_ids):
        raise ValueError("Provision results must belong to the covered marketplace scope.")
    return DataKioskProvisionRefresh(
        seller_namespace=seller_namespace,
        amazon_scope=amazon_scope,
        marketplace_ids=marketplace_ids,
        facts=tuple(fact for result in results for fact in result.facts),
        refreshed_at=refreshed_at,
    )


__all__ = ["build_data_kiosk_provision_refresh"]
