"""Typed Data Kiosk publication adapters for synthetic database fixtures."""

from collections.abc import Mapping
from datetime import date, datetime
from typing import cast

from services.sync.src.allocation import AllocationCategory
from services.sync.src.data_kiosk_economics.models import DataKioskDay, DataKioskTransaction
from services.sync.src.database.acquisitions import load_data_kiosk_acquisition
from services.sync.src.database.connection import DatabaseConnection
from services.sync.src.database.source_versions import DataKioskSelection, publish_data_kiosk
from services.sync.src.numeric import Numeric


def publish_kiosk_fixture(database: DatabaseConnection, payload: Mapping[str, object]) -> str:
    if payload.get("dataset_key") != "economics":
        raise ValueError("Data Kiosk fixtures require the economics dataset.")
    acquisition = load_data_kiosk_acquisition(database, str(payload["acquisition_id"]))
    source_days = cast(list[dict[str, object]], payload["days"])
    days: list[DataKioskDay] = []
    expected: dict[date, DataKioskSelection] = {}
    for source in source_days:
        day = date.fromisoformat(str(source["activity_date"]))
        expected[day] = DataKioskSelection(
            optional_text(source.get("expected_current_version_id")),
            optional_text(source.get("expected_current_batch_id")),
        )
        days.append(
            DataKioskDay(
                marketplace_name=cast(str, source["marketplace_name"]),
                activity_date=day,
                activity_at=datetime.fromisoformat(str(source["activity_at"])),
                content_sha256=str(source["content_sha256"]),
                transactions=tuple(
                    component(row) for row in cast(list[dict[str, object]], source["transactions"])
                ),
            )
        )
    batch = publish_data_kiosk(
        database, acquisition, days, expected, preprocess_version=str(payload["preprocess_version"])
    )
    with database.connection() as connection:
        persisted = {
            (str(day), str(key)): str(identifier)
            for day, key, identifier in connection.execute(
                "SELECT d.activity_date,c.component_key,c.id "
                "FROM private.data_kiosk_preprocess_batch_days m "
                "JOIN private.data_kiosk_days d ON d.id=m.day_id "
                "JOIN private.data_kiosk_day_components c ON c.version_id=m.version_id "
                "WHERE m.batch_id=%s",
                (batch,),
            ).fetchall()
        }
    for source in source_days:
        for row in cast(list[dict[str, object]], source["transactions"]):
            row["id"] = persisted[str(source["activity_date"]), str(row["component_key"])]
    return batch


def optional_text(value: object) -> str | None:
    return None if value is None else str(value)


def component(row: Mapping[str, object]) -> DataKioskTransaction:
    if row["amount"] is None:
        raise ValueError("A normalized source component requires an exact amount.")
    return DataKioskTransaction(
        component_key=str(row["component_key"]),
        sku=optional_text(row.get("sku")),
        category=AllocationCategory(cast(str, row.get("category"))),
        component_type=str(row["component_type"]),
        amount=Numeric(str(row["amount"])),
        currency=str(row["currency"]),
        quantity=None if row.get("quantity") is None else Numeric(str(row["quantity"])),
        fee_base=None if row.get("fee_base") is None else Numeric(str(row["fee_base"])),
    )
