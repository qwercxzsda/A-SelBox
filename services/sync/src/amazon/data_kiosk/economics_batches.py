"""Build settlement-scoped fee batches from parsed Data Kiosk evidence."""

from datetime import date

from ..auxiliary_fees import (
    AuxiliaryFeeBatch,
    AuxiliaryFeeSource,
)
from .economics_fact_normalization import validate_daily_msku_economics_fact_scope
from .economics_normalization import derive_economics_fee_observations
from .economics_processing import ParsedEconomicsFacts


def build_economics_fee_batch(
    parsed: ParsedEconomicsFacts,
    *,
    settlement_report_id: str,
    seller_namespace: str,
    amazon_scope: str,
    marketplace_id: str,
    start_date: date,
    end_date: date,
) -> AuxiliaryFeeBatch:
    """Bind parsed retained Data Kiosk charges to one Settlement report."""
    validate_daily_msku_economics_fact_scope(
        parsed.facts,
        marketplace_id=marketplace_id,
        start_date=start_date,
        end_date=end_date,
    )
    observations = derive_economics_fee_observations(parsed.facts)
    return AuxiliaryFeeBatch(
        settlement_report_id=settlement_report_id,
        source_system=AuxiliaryFeeSource.DATA_KIOSK,
        seller_namespace=seller_namespace,
        amazon_scope=amazon_scope,
        marketplace_id=marketplace_id,
        source_start_date=start_date,
        source_end_date=end_date,
        observations=observations,
    )


__all__ = [
    "build_economics_fee_batch",
]
