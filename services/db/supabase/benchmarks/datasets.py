"""Current frontend projections and independently comparable source datasets."""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Dataset:
    key: str
    relation: str
    date_column: str
    amount_column: str
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
        ("source", "source_row_id"),
    ),
    Dataset(
        "finances",
        "finances_preprocess_entries",
        "activity_at",
        "amount",
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
