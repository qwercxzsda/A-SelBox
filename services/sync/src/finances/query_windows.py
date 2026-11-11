"""UTC transaction request bounds and independently reconcilable local days."""

from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from ..amazon.datetimes import as_utc

AMAZON_RECENCY_BUFFER = timedelta(minutes=2)


class MarketplaceTimeZone(Protocol):
    @property
    def time_zone(self) -> str: ...


def comparable_end_at(posted_before: datetime | None, captured_at: datetime) -> datetime:
    """Use capture start for Amazon's implicit end, never the later download completion."""
    return (
        as_utc(posted_before)
        if posted_before is not None
        else as_utc(captured_at) - AMAZON_RECENCY_BUFFER
    )


def transaction_query_parameters(
    posted_after: datetime,
    posted_before: datetime | None = None,
    *,
    observed_at: datetime,
) -> dict[str, str]:
    """Use Amazon's near-current default unless an explicit historical end is requested."""
    now = as_utc(observed_at)
    after = as_utc(posted_after)
    before = as_utc(posted_before) if posted_before is not None else None
    latest = now - AMAZON_RECENCY_BUFFER
    if after >= latest or (before is not None and before >= latest):
        raise ValueError("Finances request bounds must be more than two minutes old.")
    end = comparable_end_at(before, now)
    if end <= after or end - after > timedelta(days=180):
        raise ValueError("Finances request windows must be ordered and no longer than 180 days.")
    try:
        earliest = now.replace(year=now.year - 2)
    except ValueError:
        earliest = now.replace(year=now.year - 2, day=28)
    if after < earliest:
        raise ValueError("Finances acquisition is outside the rolling two-year history.")
    parameters = {"postedAfter": after.isoformat()}
    if before is not None:
        parameters["postedBefore"] = before.isoformat()
    return parameters


def reconciliation_interval(
    marketplaces: Sequence[MarketplaceTimeZone],
    posted_after: datetime,
    posted_before: datetime | None,
    *,
    observed_at: datetime,
) -> tuple[date | None, date | None]:
    """Return common whole local days within the conservative captured UTC interval.

    The implicit API end is measured from capture start, never from its later
    completion. Transactions in partial boundary days remain valid observations,
    but those days cannot establish whole-day Summary or payout coverage.
    """
    if not marketplaces:
        raise ValueError("Finances reconciliation requires a marketplace roster.")
    after = as_utc(posted_after)
    end = comparable_end_at(posted_before, observed_at)
    starts: list[date] = []
    ends: list[date] = []
    for marketplace in marketplaces:
        zone = ZoneInfo(marketplace.time_zone)
        first = after.astimezone(zone).date()
        if datetime.combine(first, time.min, zone).astimezone(UTC) < after:
            first += timedelta(days=1)
        starts.append(first)
        ends.append(end.astimezone(zone).date() - timedelta(days=1))
    start, finish = max(starts), min(ends)
    return (start, finish) if start <= finish else (None, None)
