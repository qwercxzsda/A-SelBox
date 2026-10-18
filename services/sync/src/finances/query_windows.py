"""Regional UTC envelopes for explicitly requested complete local calendar days."""

from calendar import monthrange
from collections.abc import Iterator, Sequence
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from ..amazon.datetimes import as_utc
from .acquisition_models import FinancesCoverageMarketplace


def monthly_query_windows(start: date, end: date) -> Iterator[tuple[date, date]]:
    if type(start) is not date or type(end) is not date or start > end:
        raise ValueError("Finances acquisition requires an ordered pair of calendar dates.")
    current = start
    while current <= end:
        stop = min(end, current.replace(day=monthrange(current.year, current.month)[1]))
        yield current, stop
        current = stop + timedelta(days=1)


def transaction_query_parameters(
    marketplaces: Sequence[FinancesCoverageMarketplace],
    start: date,
    end: date,
    *,
    observed_at: datetime,
) -> dict[str, str]:
    """Cover every declared market's days, with no marketplace/status/account filter."""
    if not marketplaces or type(start) is not date or type(end) is not date or start > end:
        raise ValueError("Finances acquisition requires markets and ordered calendar dates.")
    now = as_utc(observed_at)
    starts = [
        datetime.combine(start, time.min, ZoneInfo(m.time_zone)).astimezone(UTC)
        for m in marketplaces
    ]
    ends = [
        datetime.combine(end + timedelta(days=1), time.min, ZoneInfo(m.time_zone)).astimezone(UTC)
        for m in marketplaces
    ]
    after, before = min(starts), max(ends)
    if before >= now - timedelta(minutes=2):
        raise ValueError(
            "Finances acquisition must end on complete local dates at least two minutes ago."
        )
    if before - after > timedelta(days=180):
        raise ValueError("Finances request windows cannot exceed 180 days.")
    try:
        earliest = now.replace(year=now.year - 2)
    except ValueError:
        earliest = now.replace(year=now.year - 2, day=28)
    if after < earliest:
        raise ValueError("Finances acquisition is outside the rolling two-year history.")
    return {"postedAfter": after.isoformat(), "postedBefore": before.isoformat()}
