"""Calendar periods used by the source sync, in UTC."""

from calendar import monthrange
from datetime import date


def shift_months(day: date, offset: int) -> date:
    year, index = divmod(day.year * 12 + day.month - 1 + offset, 12)
    month = index + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))
