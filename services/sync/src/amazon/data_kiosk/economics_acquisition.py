"""Bounded acquisition of exact Data Kiosk Economics document bytes."""

import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

from .client_protocol import DataKioskClient
from .document_acquisition import download_document
from .economics_downloads import DownloadedEconomicsPage
from .errors import (
    DataKioskErrorDocumentError,
    DataKioskPaginationLimitError,
    DataKioskResponseError,
)
from .lifecycle import (
    DEFAULT_MAX_POLL_ATTEMPTS,
    DEFAULT_POLL_INTERVAL_SECONDS,
    poll_query_until_complete,
    submit_query,
    validate_poll_settings,
)
from .limits import DEFAULT_MAX_DATA_PAGES
from .models import CompletedDataKioskQuery, DataKioskDocumentKind
from .responses import required_text


@dataclass
class _EconomicsPageAccumulator:
    """Mutable control-plane state for one bounded pagination run."""

    seen_query_ids: set[str] = field(default_factory=set[str])
    seen_document_ids: set[str] = field(default_factory=set[str])
    seen_tokens: set[str] = field(default_factory=set[str])

    def add_query(self, query_id: str) -> None:
        if query_id in self.seen_query_ids:
            raise DataKioskResponseError(
                "Data Kiosk returned a repeated query identifier during pagination."
            )
        self.seen_query_ids.add(query_id)

    def reserve_document_id(self, document_id: str | None) -> None:
        if document_id is None:
            return
        if document_id in self.seen_document_ids:
            raise DataKioskResponseError(
                "Data Kiosk returned a repeated document during pagination."
            )
        self.seen_document_ids.add(document_id)

    def add_pagination_token(self, token: str) -> None:
        if token in self.seen_tokens:
            raise DataKioskResponseError("Data Kiosk returned a repeated data pagination token.")
        self.seen_tokens.add(token)


def iter_economics_document_pages(
    client: DataKioskClient,
    query: str,
    *,
    max_pages: int = DEFAULT_MAX_DATA_PAGES,
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS,
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    on_progress: Callable[[int, str, str | None], None] | None = None,
) -> Iterator[DownloadedEconomicsPage]:
    """Yield each exact page before requesting its successor."""
    if type(max_pages) is not int or max_pages < 1:
        raise ValueError("max_pages must be greater than or equal to 1.")
    validate_poll_settings(max_poll_attempts, poll_interval_seconds)

    accumulator = _EconomicsPageAccumulator()
    pagination_token: str | None = None
    for page_number in range(1, max_pages + 1):
        query_id = submit_query(client, query, pagination_token, sleep=sleep)
        if on_progress is not None:
            on_progress(page_number, query_id, None)
        accumulator.add_query(query_id)
        completed = poll_query_until_complete(
            client,
            query_id,
            expected_query=query,
            max_attempts=max_poll_attempts,
            poll_interval_seconds=poll_interval_seconds,
            sleep=sleep,
        )
        document_id = _document_id(completed)
        if on_progress is not None:
            on_progress(page_number, query_id, document_id)
        accumulator.reserve_document_id(document_id)
        next_pagination_token = completed.next_pagination_token
        is_terminal = next_pagination_token is None
        yield DownloadedEconomicsPage(
            page_number=page_number,
            query_id=query_id,
            document_kind=completed.document_kind,
            is_terminal=is_terminal,
            document_id=document_id,
            document=(
                download_document(client, document_id, sleep=sleep)
                if document_id is not None
                else None
            ),
            api_metadata=completed.api_metadata,
        )
        if is_terminal:
            return
        accumulator.add_pagination_token(next_pagination_token)
        pagination_token = next_pagination_token
        query = required_text(completed.api_metadata, "query", "getQuery")

    raise DataKioskPaginationLimitError(
        f"Data Kiosk Economics acquisition reached the {max_pages}-page safety limit."
    )


def _document_id(completed: CompletedDataKioskQuery) -> str | None:
    if completed.document_kind is DataKioskDocumentKind.NO_DATA:
        return None
    if completed.document_kind is DataKioskDocumentKind.ERROR:
        raise DataKioskErrorDocumentError()
    if completed.data_document_id is None:
        raise DataKioskResponseError(
            "A completed Data Kiosk Economics data page omitted its document identifier."
        )
    return completed.data_document_id


__all__ = ["iter_economics_document_pages"]
