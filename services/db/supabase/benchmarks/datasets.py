"""Current frontend projections and independently comparable source datasets."""

import csv
import json
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
        "finances",
        "finances_preprocess_entries",
        "posted_date",
        "amount",
        FINANCES_COLUMNS,
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
    """Normalize timestamp/boolean representations; keep monetary values exact."""
    return [
        {
            field: datetime.fromisoformat(value).isoformat()
            if field in {"posted_at", "created_at"} and value is not None
            else {"t": "true", "f": "false"}.get(value, value)
            if field in {"activity_eligible", "is_current"} and value is not None
            else _canonical_array(field, value)
            if field in {"breakdown_path", "breakdown_indexes"} and value is not None
            else value
            for field, value in row.items()
        }
        for row in rows
    ]


def _canonical_array(field: str, value: str) -> str:
    """Compare PostgreSQL CSV array text with JSON RPC array text losslessly."""
    if value.startswith("["):
        return json.dumps(json.loads(value), ensure_ascii=False)
    if value == "{}":
        return "[]"
    values = next(csv.reader([value[1:-1]], escapechar="\\", doublequote=False))
    return json.dumps(
        [int(item) for item in values] if field == "breakdown_indexes" else values,
        ensure_ascii=False,
    )
