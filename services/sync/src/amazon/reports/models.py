"""Immutable values crossing the Reports document-transfer boundary."""

from dataclasses import dataclass, field
from typing import Literal, cast

type ReportDocumentCompression = Literal["GZIP"] | None


def normalize_report_document_compression(value: object) -> ReportDocumentCompression:
    """Validate Amazon's optional GZIP compression declaration."""
    if value is None:
        return None
    if value != "GZIP":
        raise ValueError("Report document compression algorithm must be GZIP or absent.")
    return cast(Literal["GZIP"], value)


@dataclass(frozen=True, slots=True)
class DownloadedReportDocument:
    """Exact transferred HTTP body paired with its Reports metadata."""

    transferred_content: bytes = field(repr=False)
    compression_algorithm: ReportDocumentCompression

    def __post_init__(self) -> None:
        if type(self.transferred_content) is not bytes:
            raise TypeError("Transferred report document content must be bytes.")
        object.__setattr__(
            self,
            "compression_algorithm",
            normalize_report_document_compression(self.compression_algorithm),
        )


__all__ = [
    "DownloadedReportDocument",
    "ReportDocumentCompression",
    "normalize_report_document_compression",
]
