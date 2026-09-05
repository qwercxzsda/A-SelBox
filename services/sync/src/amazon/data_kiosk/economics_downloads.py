"""Neutral retained-document values shared by acquisition and processing."""

from dataclasses import dataclass, field

from .models import DataKioskDocumentKind


@dataclass(frozen=True)
class DownloadedEconomicsPage:
    """One ordered Data Kiosk outcome and any exact bytes it exposed."""

    page_number: int
    query_id: str = field(repr=False)
    document_kind: DataKioskDocumentKind
    is_terminal: bool
    document_id: str | None = field(default=None, repr=False)
    document: bytes | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        if type(self.page_number) is not int or self.page_number < 1:
            raise ValueError("page_number must be greater than or equal to 1.")
        if type(self.is_terminal) is not bool:
            raise TypeError("is_terminal must be a boolean.")
        if not self.query_id or self.query_id != self.query_id.strip():
            raise ValueError("query_id must not be empty.")
        if self.document_kind is DataKioskDocumentKind.NO_DATA:
            if self.document_id is not None or self.document is not None:
                raise ValueError("A NO_DATA page cannot contain a document.")
            return
        if (
            self.document_id is None
            or not self.document_id
            or self.document_id != self.document_id.strip()
        ):
            raise ValueError("A DATA or ERROR page must contain a document_id.")
        if not isinstance(self.document, bytes):
            raise TypeError("A DATA or ERROR page must contain exact document bytes.")


@dataclass(frozen=True)
class DownloadedEconomicsDocuments:
    """Complete ordered output of one bounded Economics query traversal."""

    pages: tuple[DownloadedEconomicsPage, ...] = field(repr=False)

    def __post_init__(self) -> None:
        if not self.pages:
            raise ValueError("pages must not be empty.")
        if tuple(page.page_number for page in self.pages) != tuple(range(1, len(self.pages) + 1)):
            raise ValueError("Economics pages must be ordered and consecutively numbered.")
        expected_terminal_flags = (False,) * (len(self.pages) - 1) + (True,)
        if tuple(page.is_terminal for page in self.pages) != expected_terminal_flags:
            raise ValueError("Only the final Economics page may be terminal.")
        if len(set(self.query_ids)) != len(self.query_ids):
            raise ValueError("Economics pages must contain unique query identifiers.")
        if len(set(self.document_ids)) != len(self.document_ids):
            raise ValueError("Economics pages must contain unique document identifiers.")
        error_indexes = tuple(
            index
            for index, page in enumerate(self.pages)
            if page.document_kind is DataKioskDocumentKind.ERROR
        )
        if error_indexes and error_indexes != (len(self.pages) - 1,):
            raise ValueError("An ERROR document must be the final Economics page.")

    @property
    def query_ids(self) -> tuple[str, ...]:
        return tuple(page.query_id for page in self.pages)

    @property
    def document_ids(self) -> tuple[str, ...]:
        return tuple(page.document_id for page in self.pages if page.document_id is not None)


__all__ = ["DownloadedEconomicsDocuments", "DownloadedEconomicsPage"]
