import logging
import math
import os
import re
import time
from collections.abc import Callable, Mapping
from typing import cast

from sp_api.base import Marketplaces, SellingApiRequestThrottledException

_SDK_DEFAULT_MARKETPLACE_ENVIRONMENT: str = "SP_API_DEFAULT_MARKETPLACE"
DEFAULT_THROTTLE_MAX_ATTEMPTS: int = 3
DEFAULT_THROTTLE_RETRY_DELAY_SECONDS: float = 60.0
MAX_THROTTLE_RETRY_AFTER_SECONDS: int = 300

SENSITIVE_TRANSPORT_LOGGER_NAMES: tuple[str, ...] = (
    "httpcore",
    "httpx",
    "requests",
    "sp_api",
    "urllib3",
)


class AmazonTransportRoutingError(RuntimeError):
    """Raised before a client can use a process-wide marketplace override."""


def sanitized_throttled_api_call[ResultT](
    operation: Callable[[], ResultT],
    *,
    safe_error: Exception,
    max_attempts: int,
    retry_delay_seconds: float,
    max_retry_after_seconds: int,
    sleep: Callable[[float], None] = time.sleep,
) -> ResultT:
    """Retry only an explicit SDK 429 while discarding private failure context."""
    _validate_throttle_retry_settings(
        max_attempts=max_attempts,
        retry_delay_seconds=retry_delay_seconds,
        max_retry_after_seconds=max_retry_after_seconds,
    )

    for attempt in range(max_attempts):
        try:
            return operation()
        except SellingApiRequestThrottledException as error:
            if getattr(error, "code", None) != 429:
                break
            retry_after = _retry_after_from_throttle(
                error,
                maximum=max_retry_after_seconds,
            )
        except Exception:
            break

        if attempt + 1 == max_attempts:
            break
        sleep(retry_delay_seconds if retry_after is None else retry_after)

    # Raise outside the SDK exception handler so private payloads are not kept
    # in ``__context__`` or rendered by a traceback.
    raise safe_error


def _retry_after_from_throttle(
    error: SellingApiRequestThrottledException,
    *,
    maximum: int,
) -> float | None:
    """Detach one safe scalar delay from an otherwise private SDK exception."""
    headers = getattr(error, "headers", None)
    if not isinstance(headers, Mapping):
        return None
    return _strict_retry_after_seconds(
        cast(Mapping[object, object], headers),
        maximum=maximum,
    )


def _validate_throttle_retry_settings(
    *,
    max_attempts: int,
    retry_delay_seconds: float,
    max_retry_after_seconds: int,
) -> None:
    if type(max_attempts) is not int or max_attempts < 1:
        raise ValueError("max_attempts must be a positive integer.")
    if type(max_retry_after_seconds) is not int or max_retry_after_seconds < 0:
        raise ValueError("max_retry_after_seconds must be a non-negative integer.")
    if (
        type(retry_delay_seconds) not in (int, float)
        or not math.isfinite(retry_delay_seconds)
        or retry_delay_seconds < 0
        or retry_delay_seconds > max_retry_after_seconds
    ):
        raise ValueError("retry_delay_seconds must be finite and within the retry bound.")


def _strict_retry_after_seconds(
    headers: Mapping[object, object] | None,
    *,
    maximum: int,
) -> float | None:
    """Return one bounded HTTP delay-seconds value, never an untrusted date."""
    if headers is None:
        return None
    values = [
        value
        for key, value in headers.items()
        if isinstance(key, str) and key.casefold() == "retry-after"
    ]
    if len(values) != 1:
        return None
    value = values[0]
    if not isinstance(value, str) or re.fullmatch(r"[0-9]+", value) is None:
        return None
    try:
        seconds = int(value)
    except ValueError:
        # An oversized digit string can exceed Python's integer conversion
        # limit. Treat it like any other untrusted header, keeping SDK failure
        # context inside the sanitized transport boundary.
        return None
    return float(seconds) if seconds <= maximum else None


def ensure_explicit_marketplace_routing(marketplace: Marketplaces) -> None:
    """Fail closed when the SDK would replace the caller's marketplace.

    python-amazon-sp-api 2.1.20 gives ``SP_API_DEFAULT_MARKETPLACE`` precedence
    over its explicit ``marketplace=`` argument. Reject a conflicting setting
    before constructing a client so credentials cannot reach the wrong regional
    endpoint.
    """
    configured_name = os.environ.get(_SDK_DEFAULT_MARKETPLACE_ENVIRONMENT)
    if configured_name is None:
        return
    try:
        configured_marketplace = Marketplaces[configured_name]
    except KeyError:
        raise AmazonTransportRoutingError(
            "The SDK default marketplace environment setting is invalid."
        ) from None
    if configured_marketplace is not marketplace:
        raise AmazonTransportRoutingError(
            "The SDK default marketplace conflicts with the explicit credential scope."
        )


def suppress_sensitive_transport_logging() -> None:
    """Drop SDK/HTTP records that can contain presigned document URLs."""
    for logger_name in SENSITIVE_TRANSPORT_LOGGER_NAMES:
        transport_logger: logging.Logger = logging.getLogger(logger_name)
        transport_logger.handlers.clear()
        transport_logger.addHandler(logging.NullHandler())
        transport_logger.propagate = False
        transport_logger.setLevel(logging.CRITICAL + 1)


__all__ = [
    "DEFAULT_THROTTLE_MAX_ATTEMPTS",
    "DEFAULT_THROTTLE_RETRY_DELAY_SECONDS",
    "MAX_THROTTLE_RETRY_AFTER_SECONDS",
    "AmazonTransportRoutingError",
    "ensure_explicit_marketplace_routing",
    "sanitized_throttled_api_call",
    "suppress_sensitive_transport_logging",
]
