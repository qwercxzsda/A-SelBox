"""Complete immutable Finances day versions and native monetary components."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime

from ..allocation import AllocationCategory
from ..frozen_values import freeze_mapping
from ..numeric import Numeric


@dataclass(frozen=True, slots=True)
class FinancesComponent:
    component_key: str
    category: AllocationCategory
    component_type: str
    sku: str | None
    amount: Numeric
    currency: str
    quantity: Numeric | None
    fee_base: Numeric | None
    accounting_subtype: str | None
    source_fields: Mapping[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "source_fields", freeze_mapping(self.source_fields, field_name="source_fields")
        )


@dataclass(frozen=True, slots=True)
class FinancesTransaction:
    native_transaction_id: str
    account_type: str
    transaction_type: str
    transaction_status: str
    posted_at: datetime
    currency: str
    total_amount: Numeric
    deferred_transaction_id: str | None
    release_transaction_id: str | None
    activity_eligible: bool
    source_page_number: int
    source_record_number: int
    source_fields: Mapping[str, object]
    components: tuple[FinancesComponent, ...]

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "source_fields", freeze_mapping(self.source_fields, field_name="source_fields")
        )


@dataclass(frozen=True, slots=True)
class FinancesDay:
    marketplace_name: str
    marketplace_id: str
    activity_date: date
    content_sha256: str
    transactions: tuple[FinancesTransaction, ...]


@dataclass(frozen=True, slots=True)
class FinancesSummary:
    marketplace_id: str
    marketplace_name: str
    account_type: str
    currency: str
    period_start: date
    period_end: date
    net_proceeds: Numeric
    source_page_number: int
    source_summary_index: int


@dataclass(frozen=True, slots=True)
class PreparedFinances:
    days: tuple[FinancesDay, ...]
    summaries: tuple[FinancesSummary, ...]
