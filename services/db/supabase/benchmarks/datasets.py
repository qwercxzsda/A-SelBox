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
    "activity_at",
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
FINANCES_COLUMNS = (
    "id",
    "version_id",
    "transaction_id",
    "seller_namespace",
    "amazon_scope",
    "native_transaction_id",
    "current_batch_id",
    "posted_date",
    "posted_at",
    "activity_at",
    "marketplace_id",
    "marketplace_name",
    "account_type",
    "transaction_type",
    "transaction_status",
    "deferred_transaction_id",
    "release_transaction_id",
    "activity_eligible",
    "currency",
    "component_number",
    "category",
    "component_type",
    "accounting_subtype",
    "sku",
    "amount",
    "quantity",
    "fee_base",
    "breakdown_path",
    "item_index",
    "breakdown_indexes",
    "created_at",
    "is_current",
    "batch_id",
    "preprocess_version",
    "source_page_number",
    "source_record_number",
)

KIOSK_COLUMNS = (
    "id",
    "version_id",
    "day_id",
    "preprocess_version",
    "acquisition_id",
    "dataset_key",
    "current_batch_id",
    "seller_namespace",
    "marketplace_name",
    "activity_date",
    "activity_at",
    "component_key",
    "sku",
    "category",
    "component_type",
    "amount",
    "currency",
    "quantity",
    "fee_base",
    "batch_id",
    "is_current",
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
        "activity_at",
        "source_amount",
        LIVE_COLUMNS,
        ("source", "source_row_id"),
    ),
    Dataset(
        "finances",
        "finances_preprocess_entries",
        "activity_at",
        "amount",
        FINANCES_COLUMNS,
        ("id",),
    ),
    Dataset(
        "data_kiosk",
        "data_kiosk_preprocess_entries",
        "activity_at",
        "amount",
        KIOSK_COLUMNS,
        ("id",),
    ),
)


def canonical_rows(rows: list[dict[str, str | None]]) -> list[dict[str, str | None]]:
    """Normalize UTC timestamp spelling while preserving exact JSON text fields."""
    timestamps = {"posted_at", "created_at", "activity_at"}
    return [
        {
            field: datetime.fromisoformat(value).isoformat()
            if field in timestamps and value is not None
            else value
            for field, value in row.items()
        }
        for row in rows
    ]
