"""Validate complete source-day candidates before persistence."""

from collections.abc import Sequence
from datetime import timedelta

from ..amazon.marketplace_names import marketplace_name_from_id
from ..archives.models import DataKioskAcquisition
from .models import DataKioskDay


def validate_data_kiosk_days(
    acquisition: DataKioskAcquisition, days: Sequence[DataKioskDay]
) -> tuple[DataKioskDay, ...]:
    marketplace = marketplace_name_from_id(acquisition.marketplace_id)
    ordered = tuple(sorted(days, key=lambda day: day.activity_date))
    expected_count = (acquisition.query_end_date - acquisition.query_start_date).days + 1
    if len(ordered) != expected_count or any(
        day.marketplace_name != marketplace
        or day.activity_date != acquisition.query_start_date + timedelta(days=index)
        for index, day in enumerate(ordered)
    ):
        raise ValueError("Data Kiosk preprocessing must cover every acquired marketplace day once.")
    return ordered
