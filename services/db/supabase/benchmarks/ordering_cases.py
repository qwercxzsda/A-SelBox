"""Explicit frontend projections and corresponding view/RPC ordering contracts."""

from dataclasses import dataclass
from datetime import datetime

LIVE_COLUMNS = (
    "source",
    "source_row_id",
    "source_version_id",
    "preprocess_version",
    "source_identity_id",
    "seller_namespace",
    "marketplace_name",
    "activity_date",
    "sku",
    "component_type",
    "currency",
    "source_amount",
    "quantity",
    "fee_base",
    "category",
    "seller_sku_id",
    "terms_version_id",
    "company_id",
    "fee_period_id",
    "fee_rate_percent",
    "resolution_status",
    "fee_amount",
    "company_amount",
)
SETTLEMENT_COLUMNS = (
    "id",
    "version_id",
    "settlement_id",
    "preprocess_version",
    "seller_namespace",
    "source_line_number",
    "category",
    "family",
    "component_type",
    "accounting_subtype",
    "sku",
    "marketplace_name",
    "amount",
    "currency",
    "quantity",
    "posted_date",
    "posted_at",
    "transaction_type",
    "amount_type",
    "amount_description",
    "created_at",
)
KIOSK_COLUMNS = (
    "id",
    "version_id",
    "day_id",
    "preprocess_version",
    "seller_namespace",
    "marketplace_name",
    "activity_date",
    "component_key",
    "sku",
    "category",
    "component_type",
    "amount",
    "currency",
    "quantity",
    "fee_base",
    "source_document_id",
    "source_line_number",
    "created_at",
)


@dataclass(frozen=True)
class Dataset:
    key: str
    relation: str
    date_column: str
    amount_column: str
    columns: tuple[str, ...]
    tie_columns: tuple[str, ...]

    @property
    def endpoint(self) -> str:
        return "transaction_page" if self.key == "live" else "source_transaction_page"


DATASETS = (
    Dataset(
        "live",
        "live_company_components",
        "activity_date",
        "source_amount",
        LIVE_COLUMNS,
        ("source", "source_row_id"),
    ),
    Dataset(
        "settlement",
        "settlement_preprocess_entries",
        "posted_date",
        "amount",
        SETTLEMENT_COLUMNS,
        ("id",),
    ),
    Dataset(
        "data_kiosk",
        "data_kiosk_preprocess_entries",
        "activity_date",
        "amount",
        KIOSK_COLUMNS,
        ("id",),
    ),
)


@dataclass(frozen=True)
class Case:
    dataset: Dataset
    name: str
    order_by: str
    direction: str
    offset: int = 0
    marketplace: str | None = None

    @property
    def descending_date(self) -> bool:
        return self.order_by == "date" and self.direction == "desc"

    def arguments(self, *, include_count: bool = False) -> dict[str, object]:
        args: dict[str, object] = {
            "p_limit": 25,
            "p_offset": self.offset,
            "p_order_by": self.order_by,
            "p_direction": self.direction,
            "p_include_count": include_count,
        }
        if self.dataset.key != "live":
            args["p_dataset"] = self.dataset.key
        if self.marketplace is not None:
            args["p_marketplaces"] = [self.marketplace]
        return args

    def parameters(self) -> list[tuple[str, str]]:
        column = self.dataset.date_column if self.order_by == "date" else self.dataset.amount_column
        nulls = "nullsfirst" if self.descending_date else "nullslast"
        tie_direction = "desc" if self.descending_date else "asc"
        result = [
            ("select", ",".join(self.dataset.columns)),
            (
                "order",
                ",".join(
                    [
                        f"{column}.{self.direction}.{nulls}",
                        *(name + "." + tie_direction for name in self.dataset.tie_columns),
                    ]
                ),
            ),
            ("limit", "25"),
            ("offset", str(self.offset)),
        ]
        if self.dataset.key == "live":
            result.append(("and", "(or(source.neq.DATA_KIOSK,source_amount.neq.0))"))
        elif self.dataset.key == "data_kiosk":
            result.append(("amount", "neq.0"))
        if self.marketplace is not None:
            result.append(("marketplace_name", "eq." + self.marketplace))
        return result


def canonical_rows(rows: list[dict[str, str | None]]) -> list[dict[str, str | None]]:
    """CSV and JSON spell timestamptz differently; keep every other value exact."""
    return [
        {
            field: datetime.fromisoformat(value).isoformat()
            if field in {"posted_at", "created_at"} and value is not None
            else value
            for field, value in row.items()
        }
        for row in rows
    ]
