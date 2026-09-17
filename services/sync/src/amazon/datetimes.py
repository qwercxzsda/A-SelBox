from datetime import UTC, datetime


def as_utc(value: datetime) -> datetime:
    """Return an aware UTC datetime suitable for an SP-API boundary."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Amazon API datetimes must be timezone-aware.")
    return value.astimezone(UTC)


def parse_amazon_datetime(value: str) -> datetime:
    """Parse one required ISO-8601 timestamp returned by Amazon."""
    if not value.strip():
        raise ValueError("Reports API returned an invalid date-time.")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Reports API returned an invalid date-time.") from None
    return as_utc(parsed)
