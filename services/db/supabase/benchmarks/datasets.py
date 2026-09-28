"""Current frontend projections and independently comparable source datasets."""

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
    "sku_id",
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
