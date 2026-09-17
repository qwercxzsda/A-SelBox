"""Validate explicitly requested complete marketplace-local acquisition dates."""

from datetime import date, datetime

from ..amazon.datetimes import as_utc
from ..amazon.marketplaces import get_marketplace_timezone


def validate_query_window(
    marketplace_id: str,
    start_date: date,
    end_date: date,
    *,
    observed_at: datetime,
) -> None:
    """Reject partial local days, reversed windows, and unavailable source history."""
    if type(start_date) is not date or type(end_date) is not date:
        raise TypeError("Data Kiosk query coverage must use local calendar dates.")
    if start_date > end_date:
        raise ValueError("Data Kiosk query start date must not follow its end date.")
    marketplace_today = (
        as_utc(observed_at).astimezone(get_marketplace_timezone(marketplace_id)).date()
    )
    try:
        earliest = marketplace_today.replace(year=marketplace_today.year - 2)
    except ValueError:
        earliest = marketplace_today.replace(year=marketplace_today.year - 2, day=28)
    if start_date < earliest:
        raise ValueError("Data Kiosk query start date is outside the two-year history.")
    if end_date >= marketplace_today:
        raise ValueError("Data Kiosk queries must end on a complete marketplace-local date.")
