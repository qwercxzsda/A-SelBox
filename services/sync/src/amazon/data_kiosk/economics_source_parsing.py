"""Structural parsing of complete successful Data Kiosk Economics documents."""

from dataclasses import dataclass, field

from .document_preprocess import parse_jsonl_source_document
from .economics_downloads import DownloadedEconomicsDocuments
from .models import DataKioskDocumentKind, ParsedJsonlDocument


@dataclass(frozen=True)
class ParsedEconomicsPage:
    """One structurally parsed page without retaining its document bytes."""

    page_number: int
    query_id: str = field(repr=False)
    document_kind: DataKioskDocumentKind
    is_terminal: bool
    document_id: str | None = field(default=None, repr=False)
    parsed_document: ParsedJsonlDocument | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        if type(self.page_number) is not int or self.page_number < 1:
            raise ValueError("page_number must be greater than or equal to 1.")
        if not self.query_id or self.query_id != self.query_id.strip():
            raise ValueError("query_id must not be empty.")
        if type(self.is_terminal) is not bool:
            raise TypeError("is_terminal must be a boolean.")
        if self.document_kind is DataKioskDocumentKind.ERROR:
            raise ValueError("An ERROR document cannot be a successful parsed result.")
        if self.document_kind is DataKioskDocumentKind.NO_DATA:
            if self.document_id is not None or self.parsed_document is not None:
                raise ValueError("A NO_DATA page cannot contain parsed document data.")
            return
        if (
            self.document_id is None
            or not self.document_id
            or self.document_id != self.document_id.strip()
        ):
            raise ValueError("A DATA page requires a document identity.")
        if self.parsed_document is None:
            raise ValueError("A DATA page requires a parsed JSONL document.")


@dataclass(frozen=True)
class ParsedEconomicsDocuments:
    """Complete ordered parsed output for one Economics traversal."""

    pages: tuple[ParsedEconomicsPage, ...] = field(repr=False)

    def __post_init__(self) -> None:
        if not self.pages:
            raise ValueError("Parsed Economics documents must not be empty.")
        if tuple(page.page_number for page in self.pages) != tuple(range(1, len(self.pages) + 1)):
            raise ValueError("Parsed Economics pages must be contiguous and ordered.")
        expected_terminal_flags = (False,) * (len(self.pages) - 1) + (True,)
        if tuple(page.is_terminal for page in self.pages) != expected_terminal_flags:
            raise ValueError("Only the final parsed Economics page may be terminal.")
        if len(set(self.query_ids)) != len(self.query_ids):
            raise ValueError("Parsed Economics query IDs must be unique.")
        if len(set(self.document_ids)) != len(self.document_ids):
            raise ValueError("Parsed Economics document IDs must be unique.")

    @property
    def query_ids(self) -> tuple[str, ...]:
        return tuple(page.query_id for page in self.pages)

    @property
    def document_ids(self) -> tuple[str, ...]:
        return tuple(page.document_id for page in self.pages if page.document_id is not None)


def parse_economics_source_documents(
    downloaded: DownloadedEconomicsDocuments,
) -> ParsedEconomicsDocuments:
    """Parse every DATA page without interpreting Economics fields."""
    return ParsedEconomicsDocuments(
        pages=tuple(
            ParsedEconomicsPage(
                page_number=page.page_number,
                query_id=page.query_id,
                document_kind=page.document_kind,
                is_terminal=page.is_terminal,
                document_id=page.document_id,
                parsed_document=(
                    parse_jsonl_source_document(page.document)
                    if page.document is not None
                    else None
                ),
            )
            for page in downloaded.pages
        )
    )


__all__ = [
    "ParsedEconomicsDocuments",
    "ParsedEconomicsPage",
    "parse_economics_source_documents",
]
