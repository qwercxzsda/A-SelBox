"""Shared structural fakes for Data Kiosk unit tests."""

from collections.abc import Mapping
from contextlib import AbstractContextManager
from typing import cast
from unittest.mock import patch


class FakeResponse:
    def __init__(self, payload: object) -> None:
        """Store the minimal response payload consumed by the helper."""
        self.payload = payload


class FakeDataKioskClient:
    def __init__(
        self,
        *,
        create_payload: object | None = None,
        create_payloads: list[object] | None = None,
        query_payloads: list[object] | None = None,
        document_payload: object | None = None,
        document_payloads: list[object] | None = None,
        query: str = "query FakeDataKioskQuery { economics }",
    ) -> None:
        """Create a fake Data Kiosk client with queued responses."""
        self.create_payload = create_payload
        self.create_payloads: list[object] = list(create_payloads or [])
        self.query_payloads: list[object] = list(query_payloads or [])
        self.document_payload = document_payload
        self.document_payloads: list[object] = list(document_payloads or [])
        self.create_calls: list[tuple[str, str | None]] = []
        self.query_calls: list[str] = []
        self.document_calls: list[tuple[str, bool]] = []
        self._document_bytes_by_url: dict[str, bytes] = {}
        self._document_url_sequence = 0
        self.query = query

    def create_query(
        self,
        query: str,
        pagination_token: str | None = None,
    ) -> FakeResponse:
        """Record a query submission and return the configured payload."""
        self.create_calls.append((query, pagination_token))
        self.query = query
        payload = self.create_payloads.pop(0) if self.create_payloads else self.create_payload
        return FakeResponse(payload)

    def get_query(self, query_id: str) -> FakeResponse:
        """Return the next configured query status payload."""
        self.query_calls.append(query_id)
        if not self.query_payloads:
            raise AssertionError("No fake getQuery payload remains.")
        payload: object = self.query_payloads.pop(0)
        if isinstance(payload, Mapping):
            mapping = cast(Mapping[object, object], payload)
            normalized_payload = {
                key: value for key, value in mapping.items() if isinstance(key, str)
            }
            normalized_payload.setdefault("queryId", query_id)
            normalized_payload.setdefault("query", self.query)
            payload = normalized_payload
        return FakeResponse(payload)

    def get_document(self, document_id: str, download: bool = False) -> FakeResponse:
        """Return observed metadata while retaining configured bytes for HTTP fakes."""
        self.document_calls.append((document_id, download))
        payload: object = (
            self.document_payloads.pop(0) if self.document_payloads else self.document_payload
        )
        if isinstance(payload, Mapping):
            mapping = cast(Mapping[object, object], payload)
            normalized_payload = {
                key: value for key, value in mapping.items() if isinstance(key, str)
            }
            normalized_payload.setdefault("documentId", document_id)
            document = normalized_payload.pop("document", None)
            if isinstance(document, bytes):
                self._document_url_sequence += 1
                document_url = normalized_payload.setdefault(
                    "documentUrl",
                    f"https://download.invalid/data-kiosk/{self._document_url_sequence}",
                )
                if isinstance(document_url, str):
                    self._document_bytes_by_url[document_url] = document
            payload = normalized_payload
        return FakeResponse(payload)

    def download_document_bytes(self, document_url: str, **_kwargs: object) -> bytes:
        """Return bytes registered by the matching metadata response."""
        try:
            return self._document_bytes_by_url[document_url]
        except KeyError:
            raise AssertionError("No fake Data Kiosk document bytes match the URL.") from None


def fake_data_kiosk_downloads(
    client: FakeDataKioskClient,
) -> AbstractContextManager[object]:
    """Patch only the test HTTP seam for bytes registered by ``client``."""
    return patch(
        "services.sync.src.amazon.data_kiosk.document_acquisition.download_presigned_bytes",
        side_effect=client.download_document_bytes,
    )
