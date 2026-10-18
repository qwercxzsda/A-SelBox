"""Authenticated Finances transport preserving the exact decoded HTTP response."""

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from typing import Literal, Protocol, cast

import httpx
from sp_api.api import Finances

from ..client import create_explicit_sp_api_client
from ..credentials import AmazonLwaCredentials, close_quietly
from ..marketplaces import get_credential_scope
from ..transport import suppress_sensitive_transport_logging

FINANCES_API_VERSION = "2024-06-19"
type FinancesOperation = Literal["transactions", "summary"]


@dataclass(frozen=True, slots=True)
class FinancesResponse:
    """One successful response before JSON parsing or financial normalization."""

    content: bytes
    requested_at: datetime
    received_at: datetime
    request_id: str | None = None


class FinancesClient(Protocol):
    """The archive workflow depends only on lossless successful GET responses."""

    def get_page(
        self, operation: FinancesOperation, parameters: Mapping[str, str]
    ) -> FinancesResponse: ...


class _AuthenticatedClient(Protocol):
    @property
    def headers(self) -> dict[str, str]: ...


class FinancesRequestError(RuntimeError):
    """Sanitized request failure without tokens, URLs, or response bodies."""


class FinancesHttpClient:
    """Use SDK LWA authentication, with HTTP bytes archived before JSON decoding.

    The SDK's normal operation parser converts source numbers to floats. Keeping
    ``response.content`` avoids that irreversible rounding and preserves evidence.
    HTTP content encoding is decoded by httpx; application JSON is never rewritten.
    """

    def __init__(
        self,
        amazon_scope: str,
        credentials: AmazonLwaCredentials,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        scope = get_credential_scope(amazon_scope)
        self._auth = cast(
            _AuthenticatedClient,
            create_explicit_sp_api_client(
                partial(Finances, version=FINANCES_API_VERSION),
                scope.client_marketplace,
                credentials,
            ),
        )
        self._endpoint = cast(str, scope.client_marketplace.endpoint)
        self._client = httpx.Client(
            timeout=60.0, follow_redirects=False, trust_env=False, transport=transport
        )
        self._sleep = sleep
        self._last_request_at: dict[FinancesOperation, float] = {}

    def get_page(
        self, operation: FinancesOperation, parameters: Mapping[str, str]
    ) -> FinancesResponse:
        if operation not in ("transactions", "summary"):
            raise ValueError("Unsupported Finances operation.")
        suppress_sensitive_transport_logging()
        for attempt in range(3):
            elapsed = time.monotonic() - self._last_request_at.get(operation, float("-inf"))
            if elapsed < 2.0:
                self._sleep(2.0 - elapsed)
            requested_at = datetime.now(UTC)
            self._last_request_at[operation] = time.monotonic()
            try:
                response = self._client.get(
                    f"{self._endpoint}/finances/{FINANCES_API_VERSION}/{operation}",
                    params=parameters,
                    headers=self._auth.headers,
                )
            except Exception:
                break
            if response.status_code == 200:
                return FinancesResponse(
                    content=response.content,
                    requested_at=requested_at,
                    received_at=datetime.now(UTC),
                    request_id=response.headers.get("x-amzn-requestid"),
                )
            if response.status_code != 429 or attempt == 2:
                break
            delay = response.headers.get("retry-after", "")
            seconds = int(delay) if delay.isascii() and delay.isdigit() and len(delay) <= 3 else 60
            self._sleep(float(min(seconds, 60)))
        raise FinancesRequestError("Finances API request failed.")

    def close(self) -> None:
        self._client.close()
        close_quietly(self._auth)
