"""Visible-field search and bounded amount-ordering requests for the current API."""

from dataclasses import dataclass

from .ordering_cases import Case

SEARCH_COLUMNS = {
    "live": (
        "source",
        "sku",
        "component_type",
        "marketplace_name",
        "currency",
    ),
    "settlement": ("sku", "component_type", "marketplace_name", "currency"),
    "data_kiosk": ("sku", "component_type", "marketplace_name", "currency"),
}


@dataclass(frozen=True)
class SearchCase(Case):
    search: str = ""
    date_from: str | None = None
    date_to: str | None = None
    skus: tuple[str, ...] = ()
    types: tuple[str, ...] = ()
    expect_cap: bool = False

    def arguments(self, *, include_count: bool = False) -> dict[str, object]:
        return {**super().arguments(include_count=include_count), **self.filters()}

    def filters(self) -> dict[str, object]:
        return {
            "p_search": self.search,
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
