"""Normalized native transactions, immutable revisions, and typed components."""

from dataclasses import dataclass
from datetime import date, datetime

from ..numeric import Numeric


@dataclass(frozen=True, slots=True)
class FinancesComponent:
    component_number: int
    component_type: str
    sku: str | None
    amount: Numeric
    quantity: Numeric | None
    fee_base: Numeric | None
    accounting_subtype: str | None
    breakdown_path: tuple[str, ...]
    item_index: int
    breakdown_indexes: tuple[int, ...]
    route: str
    amount_part: str
    asin: str | None
    fnsku: str | None
    reference_id: str | None
    reference_month: date | None
    ledger_start_month: date | None
    ledger_end_month: date | None


@dataclass(frozen=True, slots=True)
class FinancesTransaction:
    native_transaction_id: str
    marketplace_id: str
    marketplace_name: str
    posted_date: date
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
    components: tuple[FinancesComponent, ...]
    order_id: str | None = None


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
    transactions: tuple[FinancesTransaction, ...]
    summaries: tuple[FinancesSummary, ...]
