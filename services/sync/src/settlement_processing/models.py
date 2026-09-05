"""Typed values used only while processing immutable Settlement source rows."""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal

from ..numeric import ZERO, Numeric

type HandlingMethod = Literal[
    "DIRECT_SKU",
    "AUXILIARY_EVIDENCE",
    "UNASSIGNED",
    "EXCLUDED",
]
type PnlTreatment = Literal["SKU_PNL", "ACCOUNT_EXPENSE", "EXCLUDED"]
type AuxiliarySourceSystem = Literal["DATA_KIOSK", "FBA_REPORT"]
type JoinMethod = Literal[
    "DIRECT_SETTLEMENT",
    "EXACT_KEY",
    "AGGREGATE_ALLOCATION",
    "UNATTRIBUTED",
]
type UnassignedReason = Literal[
    "MISSING_COMPANY_ASSIGNMENT",
    "NO_AUXILIARY_SOURCE",
    "NO_MATCHING_AUXILIARY_OBSERVATION",
    "AMBIGUOUS_AUXILIARY_MATCH",
    "SETTLEMENT_RESIDUAL",
    "EXCLUDED_MOVEMENT",
    "ACCOUNT_LEVEL_EXPENSE",
]

PROCESSOR_VERSION = "settlement-processing-v4"


@dataclass(frozen=True, slots=True)
class StoredSettlementRow:
    """One exact raw content row loaded from the database."""

    id: str
    source_line_number: int
    values: tuple[str, ...] = field(repr=False)


@dataclass(frozen=True, slots=True)
class StoredSettlementReport:
    """One immutable Settlement report and its exact text rows."""

    id: str
    seller_namespace: str
    amazon_scope: str
    marketplace_ids: tuple[str, ...]
    marketplace_names: tuple[str, ...]
    columns: tuple[str, ...]
    metadata_values: tuple[str, ...] = field(repr=False)
    rows: tuple[StoredSettlementRow, ...] = field(repr=False)


@dataclass(frozen=True, slots=True)
class SettlementHeader:
    settlement_id: str
    seller_namespace: str
    amazon_scope: str
    settlement_start_at: datetime
    settlement_end_at: datetime
    deposit_at: datetime
    total_amount: Numeric
    currency: str
    settlement_start_date: date
    settlement_end_date: date
    marketplace_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SettlementSourceLine:
    settlement_report_line_id: str
    source_line_number: int
    transaction_type: str
    amazon_order_id: str | None
    merchant_order_id: str | None
    amazon_adjustment_id: str | None
    amazon_shipment_id: str | None
    marketplace_name: str | None
    amount_type: str
    amount_description: str
    settlement_amount: Numeric
    fulfillment_id: str | None
    posted_date: date
    posted_at: datetime
    amazon_order_item_id: str | None
    merchant_order_item_id: str | None
    merchant_adjustment_item_id: str | None
    amz_sku: str | None
    quantity: int | None
    promotion_id: str | None


@dataclass(frozen=True, slots=True)
class LedgerEntry:
    id: str
    settlement_report_id: str
    settlement_report_line_id: str
    posted_date: date
    posted_at: datetime
    currency: str
    settlement_amount: Numeric
    transaction_type: str
    amount_type: str
    amount_description: str
    amazon_order_id: str | None
    amazon_order_item_id: str | None
    amazon_adjustment_id: str | None
    amazon_shipment_id: str | None
    marketplace_name: str | None
    marketplace_id: str | None
    amz_sku: str | None
    quantity: int | None


@dataclass(frozen=True, slots=True)
class CategoryMappingRule:
    priority: int
    transaction_type: str | None
    amount_type: str | None
    amount_description: str | None
    category_code: str
    pnl_treatment: PnlTreatment
    preferred_auxiliary_source: AuxiliarySourceSystem | None = None

    def __post_init__(self) -> None:
        if self.pnl_treatment != "SKU_PNL" and self.preferred_auxiliary_source is not None:
            raise ValueError("Only SKU P&L rules may select an auxiliary source.")


@dataclass(frozen=True, slots=True)
class ClassifiedEntry:
    ledger_entry: LedgerEntry
    category_code: str
    pnl_treatment: PnlTreatment
    handling_method: HandlingMethod
    preferred_auxiliary_source: AuxiliarySourceSystem | None


@dataclass(frozen=True, slots=True)
class AuxiliaryRequirements:
    """Amazon sources required by the categories in one Settlement report."""

    data_kiosk: bool = False
    fba_aged_storage: bool = False
    fba_removal: bool = False

    @property
    def any(self) -> bool:
        return self.data_kiosk or self.fba_aged_storage or self.fba_removal


@dataclass(frozen=True, slots=True)
class AuxiliaryFeeObservation:
    """Transient normalized evidence used to allocate a settled amount."""

    source_system: AuxiliarySourceSystem
    marketplace_id: str
    source_start_date: date
    source_end_date: date
    category_code: str
    amz_sku: str
    currency: str
    reported_amount: Numeric
    normalized_amount: Numeric
    removal_order_id: str | None
    quantity: Numeric | None = None


@dataclass(frozen=True, slots=True)
class CompanySkuFeeRateCandidate:
    """One current company/SKU/rate row, selected before period filtering."""

    company_sku_fee_rate_id: str
    company_id: str
    marketplace_id: str
    amz_sku: str
    valid_from: date
    valid_to: date | None
    fee_rate_percent: Numeric


@dataclass(frozen=True, slots=True)
class CompanyResolution:
    company_sku_fee_rate_id: str
    company_id: str
    fee_rate_percent: Numeric


@dataclass(frozen=True, slots=True)
class AllocationTargetPlan:
    id: str
    allocation_group_id: str
    company_id: str | None
    company_sku_fee_rate_id: str | None
    marketplace_id: str | None
    amz_sku: str | None
    join_method: JoinMethod
    unassigned_reason: UnassignedReason | None
    settlement_amount: Numeric
    elaborated_amount: Numeric
    selbox_fee: Numeric
    activity_start_date: date
    activity_end_date: date
    selbox_fee_base: Numeric = ZERO
    fee_rate_percent: Numeric | None = None

    settlement_quantity: Numeric | None = None
    elaborated_quantity: Numeric | None = None
    difference_quantity: Numeric | None = None
    selbox_fee_base_quantity: Numeric | None = None
    selbox_fee_quantity: Numeric | None = None
    company_payable_quantity: Numeric | None = None
    difference_amount: Numeric = field(init=False)
    company_payable: Numeric = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "difference_amount", self.settlement_amount - self.elaborated_amount
        )
        object.__setattr__(self, "company_payable", self.settlement_amount + self.selbox_fee)
        ownership_is_valid = (
            self.company_id is not None
            and self.company_sku_fee_rate_id is not None
            and self.marketplace_id is not None
            and self.amz_sku is not None
            and self.fee_rate_percent is not None
        ) or (
            self.company_id is None
            and self.company_sku_fee_rate_id is None
            and self.fee_rate_percent is None
        )
        if self.join_method in {
            "DIRECT_SETTLEMENT",
            "EXACT_KEY",
            "AGGREGATE_ALLOCATION",
        }:
            join_shape_is_valid = self.amz_sku is not None and self.difference_amount == 0
        else:
            join_shape_is_valid = (
                self.join_method == "UNATTRIBUTED"
                and self.company_id is None
                and self.amz_sku is None
                and self.elaborated_amount == 0
                and self.unassigned_reason is not None
            )
        expected_fee = (
            ZERO
            if self.fee_rate_percent is None
            else -(self.selbox_fee_base * self.fee_rate_percent * Numeric("0.01"))
        )
        if not ownership_is_valid or not join_shape_is_valid or self.selbox_fee != expected_fee:
            raise ValueError("Allocation target shape or Selbox fee is inconsistent.")


@dataclass(frozen=True, slots=True)
class AllocationGroupPlan:
    id: str
    category_code: str
    handling_method: HandlingMethod
    pnl_treatment: PnlTreatment
    amazon_order_id: str | None
    amazon_adjustment_id: str | None
    amazon_shipment_id: str | None
    representative_date: date
    marketplace_id: str | None
    marketplace_name: str | None
    currency: str
    settlement_amount: Numeric
    ledger_entry_ids: tuple[str, ...]
    targets: tuple[AllocationTargetPlan, ...]


@dataclass(frozen=True, slots=True)
class PreparedSettlement:
    report: StoredSettlementReport
    header: SettlementHeader
    source_lines: tuple[SettlementSourceLine, ...]
    ledger_entries: tuple[LedgerEntry, ...]
    transaction_start_date: date
    transaction_end_date_exclusive: date


@dataclass(frozen=True, slots=True)
class SettlementProcessingPlan:
    processing_log_id: str
    processor_version: str
    settlement: PreparedSettlement
    groups: tuple[AllocationGroupPlan, ...]


@dataclass(frozen=True, slots=True)
class SettlementProcessingResult:
    """Non-sensitive result of one workflow invocation."""

    settlement_report_id: str | None
    processing_log_id: str | None
    processed_entry_count: int = 0
    processed_result_count: int = 0
    no_unprocessed_report: bool = False
