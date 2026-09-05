"""Typed values for one successful Data Kiosk provision process."""

from dataclasses import dataclass, field
from datetime import datetime

from ...amazon.data_kiosk.economics_models import DailyMskuEconomicsFact
from ...amazon.marketplaces import validate_marketplace_scope_pair
from ..seller_namespaces import validate_seller_namespace

PROCESSOR_VERSION = "data-kiosk-provision-v1"


class DataKioskProvisionCurrencyError(ValueError):
    """Indicate that one provision fact does not have exactly one currency."""

    def __init__(self) -> None:
        super().__init__("A daily MSKU economics fact must contain exactly one currency.")

    @property
    def diagnostic_code(self) -> str:
        return "DATA_KIOSK_FACT_CURRENCY"


@dataclass(frozen=True, slots=True, kw_only=True)
class DataKioskProvisionRefresh:
    """Complete in-memory results for selected marketplace scopes."""

    seller_namespace: str
    amazon_scope: str
    marketplace_ids: tuple[str, ...]
    facts: tuple[DailyMskuEconomicsFact, ...] = field(repr=False)
    refreshed_at: datetime

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "seller_namespace",
            validate_seller_namespace(self.seller_namespace),
        )
        marketplace_ids = tuple(dict.fromkeys(self.marketplace_ids))
        if not marketplace_ids or len(marketplace_ids) != len(self.marketplace_ids):
            raise ValueError("Provision refresh marketplace IDs must be non-empty and unique.")
        for marketplace_id in marketplace_ids:
            validate_marketplace_scope_pair(self.amazon_scope, marketplace_id)
        object.__setattr__(self, "marketplace_ids", marketplace_ids)
        if self.refreshed_at.tzinfo is None or self.refreshed_at.utcoffset() is None:
            raise ValueError("refreshed_at must be timezone-aware.")
        selected_marketplaces = set(marketplace_ids)
        fact_keys: set[tuple[object, ...]] = set()
        for fact in self.facts:
            if fact.marketplace_id not in selected_marketplaces:
                raise ValueError("A provision fact is outside the refreshed marketplace scope.")
            if not fact.msku or fact.msku != fact.msku.strip():
                raise ValueError("A provision fact must use a canonical nonblank MSKU.")
            if fact.start_date != fact.end_date:
                raise ValueError("Data Kiosk provision facts must use DAY grain.")
            if fact.natural_key in fact_keys:
                raise ValueError("Data Kiosk provision facts must have unique natural keys.")
            fact_keys.add(fact.natural_key)


@dataclass(frozen=True, slots=True)
class DataKioskProvisionPersistenceResult:
    """Identity and counts from one committed provision process."""

    processing_log_id: str
    refreshed_marketplace_count: int
    provision_row_count: int


__all__ = [
    "PROCESSOR_VERSION",
    "DataKioskProvisionCurrencyError",
    "DataKioskProvisionPersistenceResult",
    "DataKioskProvisionRefresh",
]
