"""Convert source-local daily facts to immutable UTC reporting instants."""

from datetime import UTC, date, datetime, time, timedelta

from ..amazon.marketplace_names import MARKETPLACE_NAME_BY_ID
from ..amazon.marketplaces import get_marketplace_timezone

_MARKETPLACE_IDS = {name: identifier for identifier, name in MARKETPLACE_NAME_BY_ID.items()}


def reporting_activity_at(activity_date: date, marketplace_name: str) -> datetime:
    """Use the last microsecond of the local day, including daylight-saving transitions."""
    if type(activity_date) is not date:
        raise TypeError("Data Kiosk activity date must be a local calendar date.")
    if marketplace_name in _MARKETPLACE_IDS:
        zone = get_marketplace_timezone(_MARKETPLACE_IDS[marketplace_name])
    else:
        raise ValueError("Unsupported Data Kiosk reporting marketplace.")
    next_midnight = datetime.combine(activity_date + timedelta(days=1), time.min, tzinfo=zone)
    return next_midnight.astimezone(UTC) - timedelta(microseconds=1)
