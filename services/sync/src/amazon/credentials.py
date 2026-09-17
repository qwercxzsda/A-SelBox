"""Credential values and cleanup helpers shared by Amazon API adapters."""

import os
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Protocol, cast

LWA_APP_ID_ENVIRONMENT: str = "LWA_APP_ID"
LWA_CLIENT_SECRET_ENVIRONMENT: str = "LWA_CLIENT_SECRET"  # noqa: S105


@dataclass(frozen=True)
class AmazonLwaCredentials:
    """Credentials loaded only through explicitly named environment variables."""

    lwa_app_id: str = field(repr=False)
    lwa_client_secret: str = field(repr=False)
    refresh_token: str = field(repr=False)

    def __post_init__(self) -> None:
        """Reject absent or whitespace-only secrets at the shared boundary."""
        for field_name, value in (
            ("lwa_app_id", self.lwa_app_id),
            ("lwa_client_secret", self.lwa_client_secret),
            ("refresh_token", self.refresh_token),
        ):
            if not value.strip():
                raise ValueError(f"{field_name} must not be blank.")

    def as_sdk_credentials(self) -> dict[str, str]:
        """Return the explicit LWA mapping expected by python-amazon-sp-api."""
        return {
            "lwa_app_id": self.lwa_app_id,
            "lwa_client_secret": self.lwa_client_secret,
        }


class ClosableClient(Protocol):
    """Narrow cleanup boundary shared by SP-API clients."""

    def close(self) -> None:
        """Close client resources."""
        ...


def _required_environment_names(refresh_token_environment: str) -> tuple[str, ...]:
    """Return the exact environment names required for one credential scope."""
    if not refresh_token_environment.strip():
        raise ValueError("refresh_token_environment must not be blank.")
    return (
        LWA_APP_ID_ENVIRONMENT,
        LWA_CLIENT_SECRET_ENVIRONMENT,
        refresh_token_environment,
    )


def missing_environment_names(refresh_token_environment: str) -> tuple[str, ...]:
    """Return only missing variable names, never credential values."""
    return _missing_names(_required_environment_names(refresh_token_environment))


def load_lwa_credentials(refresh_token_environment: str) -> AmazonLwaCredentials:
    """Load one complete credential set or fail with environment names only."""
    missing_names = missing_environment_names(refresh_token_environment)
    if missing_names:
        raise RuntimeError(
            "Missing required Amazon credential environment names: " + ", ".join(missing_names)
        )
    return AmazonLwaCredentials(
        lwa_app_id=os.environ[LWA_APP_ID_ENVIRONMENT],
        lwa_client_secret=os.environ[LWA_CLIENT_SECRET_ENVIRONMENT],
        refresh_token=os.environ[refresh_token_environment],
    )


def _missing_names(environment_names: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(name for name in environment_names if not (os.environ.get(name) or "").strip())


def close_quietly(client: object | None) -> None:
    """Close a client without allowing cleanup errors to expose request context."""
    if client is None:
        return
    with suppress(Exception):
        cast(ClosableClient, client).close()


__all__ = [
    "LWA_APP_ID_ENVIRONMENT",
    "LWA_CLIENT_SECRET_ENVIRONMENT",
    "AmazonLwaCredentials",
    "close_quietly",
    "load_lwa_credentials",
    "missing_environment_names",
]
