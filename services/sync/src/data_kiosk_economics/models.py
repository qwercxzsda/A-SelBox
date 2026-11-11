"""Complete day versions and economic components without derived company amounts."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime

from ..allocation import AllocationCategory
from ..amazon.datetimes import as_utc
from ..canonical_values import validate_sha256
from ..numeric import Numeric


@dataclass(frozen=True, slots=True)
class DataKioskTransaction:
    component_key: str
    sku: str | None
    category: AllocationCategory
    component_type: str
    amount: Numeric
    currency: str
    quantity: Numeric | None
    fee_base: Numeric | None

    def __post_init__(self) -> None:
        object.__setattr__(self, "category", AllocationCategory(self.category))
        if self.sku is not None and not self.sku.strip():
            raise ValueError("Data Kiosk source SKU must be exact nonblank text or absent.")
        if self.category is AllocationCategory.SELBOX and self.sku is not None:
            raise ValueError("A Data Kiosk component with an MSKU cannot use the SELBOX category.")
        if self.category is AllocationCategory.DATA_KIOSK and self.sku is None:
            raise ValueError("An allocated Data Kiosk component requires its source MSKU.")


@dataclass(frozen=True, slots=True)
class DataKioskDay:
    marketplace_name: str
    activity_date: date
    activity_at: datetime
    content_sha256: str
    transactions: tuple[DataKioskTransaction, ...]

    def __post_init__(self) -> None:
        if type(self.activity_date) is not date:
            raise TypeError("Data Kiosk activity date must be a calendar date.")
        as_utc(self.activity_at)
        validate_sha256(self.content_sha256, "content_sha256")
        validate_component_keys(self.transactions)


def validate_component_keys(rows: Sequence[DataKioskTransaction]) -> None:
    keys = [row.component_key for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("Data Kiosk day contains duplicate economic component identities.")
