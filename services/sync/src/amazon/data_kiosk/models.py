from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum

from ...canonical_values import validate_sha256
from ...frozen_values import freeze_mapping


class DataKioskDocumentKind(StrEnum):
    """Describe a terminal query's data, error, or no-data outcome."""

    DATA = "DATA"
    ERROR = "ERROR"
    NO_DATA = "NO_DATA"


@dataclass(frozen=True)
class CompletedDataKioskQuery:
    """Document outcome of a completed query, including retained FATAL errors."""

    query_id: str = field(repr=False)
    document_kind: DataKioskDocumentKind
    data_document_id: str | None = field(repr=False)
    error_document_id: str | None = field(repr=False)
    next_pagination_token: str | None = field(repr=False)


@dataclass(frozen=True)
class ParsedJsonlRow:
    """One source-faithful JSONL object with its physical line retained."""

    source_line_number: int
    value: Mapping[str, object] = field(repr=False)

    def __post_init__(self) -> None:
        if type(self.source_line_number) is not int or self.source_line_number < 1:
            raise ValueError("source_line_number must be a positive integer.")
        object.__setattr__(
            self,
            "value",
            freeze_mapping(self.value, field_name="parsed Data Kiosk row"),
        )


@dataclass(frozen=True)
class ParsedJsonlDocument:
    """Simple-parse output with exact decoded lineage and ordered object rows."""

    decoded_sha256: str
    rows: tuple[ParsedJsonlRow, ...] = field(repr=False)

    def __post_init__(self) -> None:
        validate_sha256(self.decoded_sha256, "decoded_sha256")
        line_numbers = tuple(row.source_line_number for row in self.rows)
        if line_numbers != tuple(sorted(line_numbers)) or len(line_numbers) != len(
            set(line_numbers)
        ):
            raise ValueError("Parsed JSONL rows must retain unique source order.")


__all__ = [
    "CompletedDataKioskQuery",
    "DataKioskDocumentKind",
    "ParsedJsonlDocument",
    "ParsedJsonlRow",
]
