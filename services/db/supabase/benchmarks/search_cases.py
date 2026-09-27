"""Visible-field search and bounded amount-ordering requests for the current API."""

from dataclasses import dataclass

from .datasets import Dataset

SEARCH_COLUMNS = {
    "live": (
        "source",
        "sku",
        "component_type",
        "marketplace_name",
    ),
    "settlement": ("sku", "component_type", "marketplace_name"),
    "data_kiosk": ("sku", "component_type", "marketplace_name"),
}


@dataclass(frozen=True)
class SearchCase:
    dataset: Dataset
    name: str
    order_by: str
    direction: str
    offset: int = 0
    marketplace: str | None = None
    search: str = ""
    date_from: str | None = None
    date_to: str | None = None
    skus: tuple[str, ...] = ()
    types: tuple[str, ...] = ()
    expect_cap: bool = False
    search_values: dict[str, object] | None = None

    @property
    def descending_date(self) -> bool:
        return self.order_by == "date" and self.direction == "desc"

    def arguments(self, *, include_count: bool = False) -> dict[str, object]:
        return {
            "p_limit": 25,
            "p_offset": self.offset,
            "p_order_by": self.order_by,
            "p_direction": self.direction,
            "p_include_count": include_count,
            **({"p_dataset": self.dataset.key} if self.dataset.key != "live" else {}),
            **self.filters(),
        }

    def filters(self) -> dict[str, object]:
        if self.search.strip() and self.search_values is None:
            raise ValueError("Resolve search choices before building benchmark requests")
        return {
            **(self.search_values or {}),
            "p_date_from": self.date_from,
            "p_date_to": self.date_to,
            "p_skus": list(self.skus),
            "p_types": list(self.types),
            "p_marketplaces": [self.marketplace] if self.marketplace is not None else [],
        }

    def count_arguments(self) -> dict[str, object]:
        return {
            **self.filters(),
            **({"p_dataset": self.dataset.key} if self.dataset.key != "live" else {}),
        }

    @property
    def count_endpoint(self) -> str:
        return "transaction_count" if self.dataset.key == "live" else "source_transaction_count"
