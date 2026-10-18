"""Native financial marketplace identities, including the separate US MCF channel."""

from collections.abc import Sequence
from zoneinfo import ZoneInfo

from ..amazon.finances.marketplaces import NON_AMAZON_US_ID
from ..amazon.marketplace_names import marketplace_name_from_id
from ..amazon.marketplaces import get_marketplace_timezone
from .acquisition_models import FinancesCoverageMarketplace, validate_coverage_scope


def financial_marketplace_name(marketplace_id: str) -> str:
    if marketplace_id == NON_AMAZON_US_ID:
        return "Non-Amazon US"
    return marketplace_name_from_id(marketplace_id)


def financial_marketplace_timezone(marketplace_id: str) -> ZoneInfo:
    if marketplace_id == NON_AMAZON_US_ID:
        return ZoneInfo("America/Los_Angeles")
    return get_marketplace_timezone(marketplace_id)


def coverage_marketplaces(
    amazon_scope: str, marketplace_ids: Sequence[str]
) -> tuple[FinancesCoverageMarketplace, ...]:
    """Keep financial channels distinct even when their local-day zones coincide."""
    if not marketplace_ids or len(set(marketplace_ids)) != len(marketplace_ids):
        raise ValueError("Finances coverage roster must be nonempty and unique.")
    marketplaces = tuple(
        FinancesCoverageMarketplace(
            identifier,
            financial_marketplace_name(identifier),
            financial_marketplace_timezone(identifier).key,
        )
        for identifier in marketplace_ids
    )
    validate_coverage_scope(amazon_scope, marketplaces)
    return marketplaces
