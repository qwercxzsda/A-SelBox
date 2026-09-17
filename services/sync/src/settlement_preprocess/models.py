"""Complete typed settlement source facts, independent of business configuration."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from types import MappingProxyType

from ..allocation import AllocationCategory
from ..frozen_values import freeze_mapping
from ..numeric import Numeric


@dataclass(frozen=True, slots=True)
class SettlementHeader:
    settlement_id: str
    settlement_start_at: datetime
    settlement_end_at: datetime
    deposit_at: datetime
    settlement_start_date: date
    settlement_end_date: date
    total_amount: Numeric
    currency: str
    source_line_number: int


@dataclass(frozen=True, slots=True)
class SettlementTransaction:
    source_line_number: int
    category: AllocationCategory
    family: str | None
    component_type: str
    accounting_subtype: str | None
    sku: str | None
    marketplace_name: str | None
    amount: Numeric
    currency: str
    quantity: int | None
    posted_date: date
    posted_at: datetime
    transaction_type: str
    amount_type: str
    amount_description: str
    source_fields: Mapping[str, str]

    def __post_init__(self) -> None:
        object.__setattr__(self, "category", AllocationCategory(self.category))
        if self.category is AllocationCategory.ANALYSIS_ONLY:
            raise ValueError("A Settlement row cannot use the ANALYSIS_ONLY category.")
        object.__setattr__(self, "source_fields", MappingProxyType(dict(self.source_fields)))


@dataclass(frozen=True, slots=True)
class PreparedSettlement:
    header: SettlementHeader
    transactions: tuple[SettlementTransaction, ...]
    diagnostics: tuple[Mapping[str, object], ...]
    document_sha256: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "diagnostics",
            tuple(freeze_mapping(item, field_name="diagnostics") for item in self.diagnostics),
        )

    @property
    def observed_start_date(self) -> date | None:
        return min((row.posted_date for row in self.transactions), default=None)

    @property
    def observed_end_date(self) -> date | None:
        return max((row.posted_date for row in self.transactions), default=None)
