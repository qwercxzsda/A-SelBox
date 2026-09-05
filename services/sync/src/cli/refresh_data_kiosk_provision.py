"""Download, process, and atomically append a Data Kiosk provision batch."""

import argparse
import logging
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from ..amazon.client import create_data_kiosk_client
from ..amazon.credentials import close_quietly, load_lwa_credentials
from ..amazon.data_kiosk.client_protocol import DataKioskClient
from ..amazon.data_kiosk.lifecycle import (
    DEFAULT_MAX_POLL_ATTEMPTS,
    DEFAULT_POLL_INTERVAL_SECONDS,
)
from ..amazon.data_kiosk.limits import DEFAULT_MAX_DATA_PAGES
from ..amazon.datetimes import as_utc
from ..amazon.marketplaces import get_credential_scope
from ..amazon.scopes import DEFAULT_AMAZON_SCOPE, validate_amazon_scope
from ..amazon.sellers_participations import (
    MarketplaceParticipation,
    fetch_marketplace_participations,
)
from ..amazon.transport import suppress_sensitive_transport_logging
from ..data_kiosk_economics.acquisition import (
    MarketplaceProvisionData,
    download_and_process_data_kiosk_provision,
)
from ..data_kiosk_economics.processing import build_data_kiosk_provision_refresh
from ..data_kiosk_economics.query_windows import (
    DEFAULT_DAILY_REFRESH_DAYS,
    MarketplaceQueryWindow,
    resolve_query_window,
)
from ..database.connection import PostgresDatabaseConnection
from ..database.data_kiosk_economics import (
    DataKioskProvisionPersistenceResult,
    persist_data_kiosk_provisions,
)
from ..database.seller_namespaces import validate_seller_namespace
from .common import (
    add_log_and_env_arguments,
    add_storage_arguments,
    canonical_date,
    initialize_cli,
    non_negative_float,
    positive_int,
)

logger = logging.getLogger("run_refresh_data_kiosk_provision")


@dataclass(frozen=True, slots=True)
class RefreshDataKioskProvisionSettings:
    """Validated tenant, query-window, and network settings."""

    amazon_scope: str
    database_url: str = field(repr=False)
    seller_namespace: str
    marketplace_windows: tuple[MarketplaceQueryWindow, ...]
    use_active_scope_marketplaces: bool = False
    max_pages: int = DEFAULT_MAX_DATA_PAGES
    max_poll_attempts: int = DEFAULT_MAX_POLL_ATTEMPTS
    poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS

    def __post_init__(self) -> None:
        amazon_scope = validate_amazon_scope(self.amazon_scope)
        object.__setattr__(self, "amazon_scope", amazon_scope)
        credential_scope = get_credential_scope(amazon_scope)
        if not self.database_url.strip():
            raise ValueError("Database URL must not be blank.")
        object.__setattr__(
            self,
            "seller_namespace",
            validate_seller_namespace(self.seller_namespace),
        )
        if not self.marketplace_windows:
            raise ValueError("At least one marketplace query window is required.")
        marketplace_ids = [window.marketplace_id for window in self.marketplace_windows]
        if len(marketplace_ids) != len(set(marketplace_ids)):
            raise ValueError("Marketplace query windows must use unique marketplace IDs.")
        if not set(marketplace_ids).issubset(credential_scope.marketplace_ids):
            raise ValueError("Marketplace query windows must belong to the selected scope.")
        if type(self.use_active_scope_marketplaces) is not bool:
            raise TypeError("use_active_scope_marketplaces must be a boolean.")
        for field_name, value in (
            ("max_pages", self.max_pages),
            ("max_poll_attempts", self.max_poll_attempts),
        ):
            if type(value) is not int or value < 1:
                raise ValueError(f"{field_name} must be a positive integer.")
        if (
            type(self.poll_interval_seconds) not in (int, float)
            or not math.isfinite(self.poll_interval_seconds)
            or self.poll_interval_seconds < 0
        ):
            raise ValueError("Poll interval seconds must be finite and not negative.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Download and process Data Kiosk Economics in memory, then atomically "
            "store a processing log and its provision results."
        )
    )
    parser.add_argument(
        "--scope",
        default=DEFAULT_AMAZON_SCOPE,
        help="Exact Amazon refresh-token and provision scope.",
    )
    add_storage_arguments(parser)
    parser.add_argument(
        "--marketplace-id",
        action="append",
        default=None,
        dest="marketplace_ids",
        help="Marketplace to refresh. Repeat as needed; defaults to active scope marketplaces.",
    )
    parser.add_argument(
        "--start-date",
        type=canonical_date,
        help="Inclusive marketplace-local start date; requires --end-date.",
    )
    parser.add_argument(
        "--end-date",
        type=canonical_date,
        help="Inclusive marketplace-local end date; requires --start-date.",
    )
    parser.add_argument(
        "--refresh-days",
        type=positive_int,
        help=f"Complete local days to refresh (default: {DEFAULT_DAILY_REFRESH_DAYS}).",
    )
    parser.add_argument("--max-pages", default=DEFAULT_MAX_DATA_PAGES, type=positive_int)
    parser.add_argument(
        "--max-poll-attempts",
        default=DEFAULT_MAX_POLL_ATTEMPTS,
        type=positive_int,
    )
    parser.add_argument(
        "--poll-interval-seconds",
        default=DEFAULT_POLL_INTERVAL_SECONDS,
        type=non_negative_float,
    )
    add_log_and_env_arguments(parser)
    return parser


def settings_from_args(
    args: argparse.Namespace,
    *,
    now: datetime | None = None,
) -> RefreshDataKioskProvisionSettings:
    amazon_scope = validate_amazon_scope(args.scope)
    credential_scope = get_credential_scope(amazon_scope)
    requested_marketplaces = tuple(dict.fromkeys(args.marketplace_ids or ()))
    if not set(requested_marketplaces).issubset(credential_scope.marketplace_ids):
        raise ValueError("A requested marketplace does not belong to the selected scope.")
    marketplace_ids = requested_marketplaces or credential_scope.marketplace_ids
    explicit_window = _explicit_query_window(args.start_date, args.end_date)
    if explicit_window is not None and args.refresh_days is not None:
        raise ValueError("--refresh-days cannot be combined with explicit dates.")
    refresh_days = DEFAULT_DAILY_REFRESH_DAYS if args.refresh_days is None else args.refresh_days
    resolved_at = as_utc(now or datetime.now(UTC))
    return RefreshDataKioskProvisionSettings(
        amazon_scope=amazon_scope,
        database_url=args.database_url,
        seller_namespace=args.seller_namespace,
        marketplace_windows=tuple(
            resolve_query_window(
                marketplace_id,
                explicit_window=explicit_window,
                refresh_days=refresh_days,
                resolved_at=resolved_at,
            )
            for marketplace_id in marketplace_ids
        ),
        use_active_scope_marketplaces=not requested_marketplaces,
        max_pages=args.max_pages,
        max_poll_attempts=args.max_poll_attempts,
        poll_interval_seconds=args.poll_interval_seconds,
    )


def run(
    settings: RefreshDataKioskProvisionSettings,
    *,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> DataKioskProvisionPersistenceResult:
    """Finish every Amazon operation before opening the persistence transaction."""
    suppress_sensitive_transport_logging()
    credential_scope = get_credential_scope(settings.amazon_scope)
    credentials = load_lwa_credentials(credential_scope.refresh_token_environment)
    participations = fetch_marketplace_participations(credential_scope, credentials)
    marketplace_windows = participating_marketplace_windows(settings, participations)
    client = None
    try:
        client = create_data_kiosk_client(credential_scope.client_marketplace, credentials)
        marketplace_data = tuple(
            _download_marketplace(client, settings, window) for window in marketplace_windows
        )
    finally:
        close_quietly(client)

    refreshed_at = as_utc(now())
    refresh = build_data_kiosk_provision_refresh(
        marketplace_data,
        seller_namespace=settings.seller_namespace,
        amazon_scope=settings.amazon_scope,
        refreshed_at=refreshed_at,
        covered_marketplace_ids=tuple(
            window.marketplace_id for window in settings.marketplace_windows
        ),
    )
    with PostgresDatabaseConnection(settings.database_url) as database:
        return persist_data_kiosk_provisions(database, refresh)


def _download_marketplace(
    client: DataKioskClient,
    settings: RefreshDataKioskProvisionSettings,
    window: MarketplaceQueryWindow,
) -> MarketplaceProvisionData:
    return download_and_process_data_kiosk_provision(
        client,
        marketplace_id=window.marketplace_id,
        query_start_date=window.start_date,
        query_end_date=window.end_date,
        max_pages=settings.max_pages,
        max_poll_attempts=settings.max_poll_attempts,
        poll_interval_seconds=settings.poll_interval_seconds,
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    try:
        result = run(settings_from_args(args))
    except Exception as error:
        logger.error(
            "Data Kiosk provision refresh failed "
            "[code=DATA_KIOSK_PROVISION_REFRESH_FAILED, exception_type=%s].",
            type(error).__name__,
        )
        return 1
    logger.info(
        "Data Kiosk provision refresh finished. process=%s marketplaces=%s rows=%s",
        result.processing_log_id,
        result.refreshed_marketplace_count,
        result.provision_row_count,
    )
    return 0


def participating_marketplace_windows(
    settings: RefreshDataKioskProvisionSettings,
    participations: Sequence[MarketplaceParticipation],
) -> tuple[MarketplaceQueryWindow, ...]:
    participating_ids = {item.marketplace_id for item in participations}
    active_windows = tuple(
        window
        for window in settings.marketplace_windows
        if window.marketplace_id in participating_ids
    )
    if settings.use_active_scope_marketplaces:
        if not active_windows:
            raise RuntimeError("The selected Amazon scope has no participating marketplaces.")
    elif len(active_windows) != len(settings.marketplace_windows):
        raise ValueError("A requested marketplace is not active in the Sellers API response.")
    return active_windows


def _explicit_query_window(
    start_date: date | None,
    end_date: date | None,
) -> tuple[date, date] | None:
    if (start_date is None) != (end_date is None):
        raise ValueError("Pass both --start-date and --end-date, or neither.")
    if start_date is None or end_date is None:
        return None
    if start_date > end_date:
        raise ValueError("--start-date must not be after --end-date.")
    return start_date, end_date


__all__ = [
    "DEFAULT_AMAZON_SCOPE",
    "MarketplaceQueryWindow",
    "RefreshDataKioskProvisionSettings",
    "build_parser",
    "main",
    "participating_marketplace_windows",
    "run",
    "settings_from_args",
]
