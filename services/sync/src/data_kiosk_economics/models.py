"""Complete day versions and economic components without derived company amounts."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

from ..allocation import AllocationCategory
from ..frozen_values import freeze_mapping
from ..numeric import Numeric


@dataclass(frozen=True, slots=True)
class DataKioskTransaction:
    component_key: str
    sku: str
    category: AllocationCategory
    component_type: str
    amount: Numeric
    currency: str
    quantity: Numeric | None
    fee_base: Numeric | None
    native_dimensions: Mapping[str, object]
    source_document_id: str
    source_line_number: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "category", AllocationCategory(self.category))
        if self.category is AllocationCategory.SELBOX and self.sku.strip():
            raise ValueError("A Data Kiosk component with an MSKU cannot use the SELBOX category.")
        object.__setattr__(
            self,
            "native_dimensions",
            freeze_mapping(
                self.native_dimensions,
                field_name="native_dimensions",
            ),
        )


@dataclass(frozen=True, slots=True)
class DataKioskDay:
    marketplace_name: str
    activity_date: date
    content_sha256: str
    transactions: tuple[DataKioskTransaction, ...]
