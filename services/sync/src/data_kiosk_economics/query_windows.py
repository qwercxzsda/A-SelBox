"""Marketplace-local query windows for rolling Data Kiosk provisions."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from ..amazon.datetimes import as_utc
from ..amazon.identifiers import validate_marketplace_id
from ..amazon.marketplaces import get_marketplace_timezone

DEFAULT_DAILY_REFRESH_DAYS = 60


@dataclass(frozen=True, slots=True)
class MarketplaceQueryWindow:
    """One marketplace and its inclusive marketplace-local query dates."""

    marketplace_id: str
    start_date: date
    end_date: date

    def __post_init__(self) -> None:
        object.__setattr__(self, "marketplace_id", validate_marketplace_id(self.marketplace_id))
        if self.start_date > self.end_date:
            raise ValueError("Marketplace query start date must not be after its end date.")


def default_query_window(
    *,
    marketplace_today: date,
    refresh_days: int = DEFAULT_DAILY_REFRESH_DAYS,
) -> tuple[date, date]:
    """Return the latest complete marketplace-local days as an inclusive window."""
    if type(refresh_days) is not int or refresh_days < 1:
        raise ValueError("refresh_days must be greater than or equal to 1.")
    end_date = marketplace_today - timedelta(days=1)
    return end_date - timedelta(days=refresh_days - 1), end_date


def resolve_query_window(
    marketplace_id: str,
    *,
    explicit_window: tuple[date, date] | None,
    refresh_days: int,
    resolved_at: datetime,
) -> MarketplaceQueryWindow:
    """Resolve complete local dates within Data Kiosk's two-year history."""
    marketplace_today = (
        as_utc(resolved_at).astimezone(get_marketplace_timezone(marketplace_id)).date()
    )
    start_date, end_date = (
        default_query_window(marketplace_today=marketplace_today, refresh_days=refresh_days)
        if explicit_window is None
        else explicit_window
    )
    if start_date < _calendar_years_before(marketplace_today, years=2):
        raise ValueError("Data Kiosk query start date is outside the two-year history.")
    if end_date >= marketplace_today:
        raise ValueError("Data Kiosk queries must end on a complete marketplace-local date.")
    return MarketplaceQueryWindow(marketplace_id, start_date, end_date)


def _calendar_years_before(value: date, *, years: int) -> date:
    try:
        return value.replace(year=value.year - years)
    except ValueError:
        return value.replace(year=value.year - years, day=28)


__all__ = [
    "DEFAULT_DAILY_REFRESH_DAYS",
    "MarketplaceQueryWindow",
    "default_query_window",
    "resolve_query_window",
]
