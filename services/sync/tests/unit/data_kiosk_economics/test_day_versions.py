"""Day versions describe normalized contents independently of their observations."""

import unittest
from dataclasses import replace
from datetime import timedelta
from typing import Any, cast
from unittest.mock import patch

from ....src.data_kiosk_economics.components import build_components
from ....src.data_kiosk_economics.preprocess import prepare_data_kiosk_acquisition
from ....src.database.source_versions import (
    DataKioskSelection,
    current_data_kiosk_selections,
    publish_data_kiosk,
)
from ....src.numeric import Numeric
from ...support.archives import MemoryArchiveStorage
from ...support.economics import (
    complete_economics_document,
    complete_economics_fact,
    economics_fee,
)
from ...support.fakes import FakeDatabaseConnection
from ...support.source_preprocessing import kiosk_acquisition


class DataKioskDayVersionTests(unittest.TestCase):
    def test_reporting_time_interpretation_is_part_of_immutable_day_contents(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = kiosk_acquisition(storage, complete_economics_document())
        original = prepare_data_kiosk_acquisition(acquisition, storage)[0]
        self.assertEqual(original.activity_at.isoformat(), "2026-08-02T06:59:59.999999+00:00")
        changed_time = original.activity_at + timedelta(hours=1)
        with patch(
            "services.sync.src.data_kiosk_economics.preprocess.reporting_activity_at",
            return_value=changed_time,
        ):
            changed = prepare_data_kiosk_acquisition(acquisition, storage)[0]
        self.assertEqual(changed.activity_date, original.activity_date)
        self.assertEqual(changed.transactions, original.transactions)
        self.assertEqual(changed.activity_at, changed_time)
        self.assertNotEqual(changed.content_sha256, original.content_sha256)

    def test_decimal_formatting_does_not_change_day_contents(self) -> None:
        storage = MemoryArchiveStorage()
        hashes: set[str] = set()
        for amount in ("6", "6.000", "6e0"):
            document = complete_economics_document(
                fees=f"[{economics_fee('DisposalFee', amount=amount)}]"
            )
            days = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, document), storage)
            self.assertEqual(days[0].transactions[0].amount, Numeric(-6))
            hashes.add(days[0].content_sha256)
        self.assertEqual(len(hashes), 1)

    def test_normalized_value_changes_and_unknown_quantities_have_distinct_versions(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = kiosk_acquisition(storage, complete_economics_document())
        component = build_components(complete_economics_fact())[0]
        hashes: set[str] = set()
        for row in (
            component,
            replace(component, amount=component.amount + 1),
            replace(component, quantity=None),
            replace(component, quantity=Numeric(0)),
            replace(component, fee_base=None),
            replace(component, category="DATA_KIOSK"),
        ):
            with patch(
                "services.sync.src.data_kiosk_economics.preprocess.build_components",
                return_value=(row,),
            ):
                days = prepare_data_kiosk_acquisition(acquisition, storage)
            hashes.add(days[0].content_sha256)
        self.assertEqual(len(hashes), 6)

    def test_publication_keeps_observation_selection_separate_from_typed_contents(self) -> None:
        storage = MemoryArchiveStorage()
        document = complete_economics_document(fees=f"[{economics_fee('DisposalFee')}]")
        acquisition = kiosk_acquisition(storage, document)
        days = prepare_data_kiosk_acquisition(acquisition, storage)
        database = FakeDatabaseConnection(
            fetchall_results=[[(days[0].activity_date, "previous-version", "previous-batch")]]
        )
        selected = current_data_kiosk_selections(database, acquisition, "Amazon.com")
        self.assertEqual(
            selected,
            {days[0].activity_date: DataKioskSelection("previous-version", "previous-batch")},
        )
        with patch(
            "services.sync.src.database.source_versions.publish_json", return_value="saved-batch"
        ) as publish:
            self.assertEqual(
                publish_data_kiosk(database, acquisition, days, selected), "saved-batch"
            )
        payload = cast(dict[str, Any], publish.call_args.args[2])
        published = payload["days"][0]
        self.assertEqual(published["activity_date"], days[0].activity_date.isoformat())
        self.assertEqual(published["activity_at"], days[0].activity_at.isoformat())
        self.assertEqual(published["expected_current_version_id"], "previous-version")
        self.assertEqual(published["expected_current_batch_id"], "previous-batch")
        self.assertEqual(
            set(published["transactions"][0]),
            {
                "id",
                "component_key",
                "sku",
                "category",
                "component_type",
                "amount",
                "currency",
                "quantity",
                "fee_base",
            },
        )
        empty = payload["days"][1]
        self.assertIsNone(empty["expected_current_version_id"])
        self.assertIsNone(empty["expected_current_batch_id"])
        self.assertEqual(empty["transactions"], [])
