"""Complete captures preserve native money without lifecycle double counting."""

import copy
import unittest
from dataclasses import replace
from datetime import date
from typing import cast

from services.sync.src.finances.components import build_components
from services.sync.src.finances.preprocess import prepare_finances_acquisition
from services.sync.src.finances.validation import revision_digest
from services.sync.src.numeric import ZERO, Numeric
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.finances import finances_acquisition, native_transaction


class FinancesPreprocessingTests(unittest.TestCase):
    def test_linked_release_is_retained_but_does_not_add_activity(self) -> None:
        storage = MemoryArchiveStorage()
        original = native_transaction(status="DEFERRED_RELEASED", release="B")
        released = native_transaction(
            "B", status="RELEASED", original="A", posted="2026-08-02T12:00:00Z"
        )
        prepared = prepare_finances_acquisition(
            finances_acquisition(storage, [original, released], summary_amount="100"), storage
        )
        rows = prepared.transactions
        self.assertEqual([r.activity_eligible for r in rows], [True, False])
        self.assertEqual(
            sum((r.total_amount for r in rows if r.activity_eligible), ZERO), Numeric(100)
        )
        self.assertEqual(prepared.summaries[0].net_proceeds, Numeric(100))

    def test_status_update_changes_full_revision_without_mutating_old_state(
        self,
    ) -> None:
        storage = MemoryArchiveStorage()
        first = prepare_finances_acquisition(
            finances_acquisition(storage, [native_transaction()]), storage
        )
        second = prepare_finances_acquisition(
            finances_acquisition(
                storage, [native_transaction(status="DEFERRED_RELEASED", release="B")]
            ),
            storage,
        )
        self.assertNotEqual(
            revision_digest(first.transactions[0]), revision_digest(second.transactions[0])
        )
        self.assertEqual(first.transactions[0].transaction_status, "DEFERRED")
        self.assertEqual(second.transactions[0].transaction_status, "DEFERRED_RELEASED")

    def test_empty_capture_has_no_invented_transactions(self) -> None:
        storage = MemoryArchiveStorage()
        first = prepare_finances_acquisition(
            finances_acquisition(storage, [native_transaction()]), storage
        )
        empty = prepare_finances_acquisition(finances_acquisition(storage), storage)
        self.assertTrue(first.transactions)
        self.assertEqual(empty.transactions, ())

    def test_identical_repeated_record_is_counted_once_and_conflict_is_rejected(self) -> None:
        storage = MemoryArchiveStorage()
        row = native_transaction()
        prepared = prepare_finances_acquisition(finances_acquisition(storage, [row, row]), storage)
        self.assertEqual(len(prepared.transactions), 1)
        with self.assertRaisesRegex(ValueError, "Conflicting Finances transaction"):
            prepare_finances_acquisition(
                finances_acquisition(storage, [row, native_transaction(amount="101")]), storage
            )

    def test_missing_original_does_not_turn_a_release_into_new_activity(self) -> None:
        storage = MemoryArchiveStorage()
        released = native_transaction("B", status="RELEASED", original="outside-window")
        prepared = prepare_finances_acquisition(finances_acquisition(storage, [released]), storage)
        self.assertFalse(prepared.transactions[0].activity_eligible)

    def test_directly_released_activity_is_included(self) -> None:
        storage = MemoryArchiveStorage()
        row = native_transaction(status="RELEASED")
        prepared = prepare_finances_acquisition(finances_acquisition(storage, [row]), storage)
        self.assertTrue(prepared.transactions[0].activity_eligible)

    def test_reverse_link_alone_identifies_a_release(self) -> None:
        storage = MemoryArchiveStorage()
        rows = [
            native_transaction(release="B"),
            native_transaction("B", status="RELEASED"),
        ]
        result = prepare_finances_acquisition(finances_acquisition(storage, rows), storage)
        self.assertEqual([t.activity_eligible for t in result.transactions], [True, False])
        self.assertIsNone(result.transactions[1].deferred_transaction_id)

    def test_conflicting_lifecycle_links_and_money_fail_complete_capture(self) -> None:
        for release in (
            native_transaction("B", status="RELEASED", original="C"),
            native_transaction("B", status="RELEASED", original="A", amount="99"),
        ):
            with self.subTest(release=release), self.assertRaisesRegex(ValueError, "Finances"):
                storage = MemoryArchiveStorage()
                prepare_finances_acquisition(
                    finances_acquisition(storage, [native_transaction(release="B"), release]),
                    storage,
                )

    def test_reordered_items_retain_their_changed_source_positions(self) -> None:
        storage = MemoryArchiveStorage()
        row = native_transaction(amount="30")
        row["items"] = [
            *cast(list[object], native_transaction(amount="10")["items"]),
            *cast(list[object], native_transaction(amount="20")["items"]),
        ]
        first = prepare_finances_acquisition(finances_acquisition(storage, [row]), storage)
        row["items"] = list(reversed(row["items"]))
        second = prepare_finances_acquisition(finances_acquisition(storage, [row]), storage)
        self.assertNotEqual(
            revision_digest(first.transactions[0]), revision_digest(second.transactions[0])
        )

    def test_local_midnight_edges_do_not_leak_adjacent_day_activity(self) -> None:
        storage = MemoryArchiveStorage()
        outside = native_transaction("before", posted="2026-08-01T06:59:59Z")
        inside = native_transaction("inside", posted="2026-08-01T07:00:00Z")
        result = prepare_finances_acquisition(
            finances_acquisition(storage, [outside, inside]), storage
        )
        self.assertEqual([t.native_transaction_id for t in result.transactions], ["inside"])

    def test_unknown_marketplace_cannot_be_silently_dropped(self) -> None:
        storage = MemoryArchiveStorage()
        row = native_transaction()
        row["sellingPartnerMetadata"] = {
            "sellingPartnerId": "seller-api",
            "marketplaceId": "unknown",
            "accountType": "Standard Orders",
        }
        with self.assertRaisesRegex(ValueError, "outside declared coverage"):
            prepare_finances_acquisition(finances_acquisition(storage, [row]), storage)

    def test_empty_optional_order_identifier_does_not_invalidate_native_activity(self) -> None:
        row = native_transaction()
        row["relatedIdentifiers"] = [
            {"relatedIdentifierName": "ORDER_ID", "relatedIdentifierValue": ""}
        ]
        storage = MemoryArchiveStorage()
        result = prepare_finances_acquisition(finances_acquisition(storage, [row]), storage)
        self.assertTrue(result.transactions[0].activity_eligible)

    def test_reverse_only_release_cannot_lose_its_outside_day_dependency(self) -> None:
        storage = MemoryArchiveStorage()
        rows = [
            native_transaction(release="B", posted="2026-08-01T06:00:00Z"),
            native_transaction("B", status="RELEASED"),
        ]
        with self.assertRaisesRegex(ValueError, "original in covered days"):
            prepare_finances_acquisition(finances_acquisition(storage, rows), storage)

    def test_summary_dates_must_equal_capture_scope(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = finances_acquisition(storage, summary_amount="0")
        with self.assertRaises(ValueError):
            prepare_finances_acquisition(
                replace(acquisition, query_end_date=date(2026, 8, 3)), storage
            )

    def test_summary_cannot_control_another_sellers_transactions(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = finances_acquisition(
            storage, [native_transaction()], summary_amount="100", summary_seller="other-seller"
        )
        with self.assertRaisesRegex(ValueError, "different Amazon sellers"):
            prepare_finances_acquisition(acquisition, storage)

    def test_transaction_controls_are_not_added_to_their_components(self) -> None:
        row = native_transaction()
        components = build_components(row)
        self.assertEqual(len(components), 1)
        self.assertEqual(sum((r.amount for r in components), ZERO), Numeric(100))

    def test_legitimate_split_items_have_distinct_component_numbers(self) -> None:
        row = native_transaction(amount="100")
        items = copy.deepcopy(cast(list[object], row["items"]))
        self.assertIsInstance(items, list)
        row["items"] = items + copy.deepcopy(items)
        row["totalAmount"] = {"currencyAmount": "200", "currencyCode": "USD"}
        components = build_components(row)
        self.assertEqual(len(components), 2)
        self.assertEqual(len({r.component_number for r in components}), 2)
        self.assertEqual(sum((r.amount for r in components), ZERO), Numeric(200))

    def test_zero_native_item_without_currency_is_preserved_using_parent_currency(self) -> None:
        row = native_transaction(amount="0")
        row["items"] = [
            {
                "totalAmount": {"currencyAmount": 0, "currencyCode": None},
                "contexts": [
                    {"contextType": "ProductContext", "sku": "SKU-1", "quantityShipped": 1}
                ],
                "breakdowns": [],
            }
        ]
        component = build_components(row)[0]
        self.assertEqual(component.amount, ZERO)
        self.assertEqual(component.breakdown_path, ())
        self.assertEqual(component.item_index, 0)

    def test_missing_nonzero_breakdown_is_not_replaced_by_balancing_amount(self) -> None:
        row = native_transaction()
        row["items"] = []
        row["breakdowns"] = []
        with self.assertRaisesRegex(ValueError, "monetary detail is missing"):
            build_components(row)

    def test_native_zero_disposal_retains_its_category_without_inventing_a_sku(self) -> None:
        row = native_transaction(amount="0", status="RELEASED")
        row.update(transactionType="ServiceFee", description="FBADisposal", items=[], breakdowns=[])
        component = build_components(row)[0]
        self.assertEqual(component.component_type, "DISPOSAL_FEES")
        self.assertEqual(component.category.value, "DATA_KIOSK")
        self.assertEqual(component.amount, ZERO)
        self.assertIsNone(component.sku)
        row["totalAmount"] = {"currencyAmount": "1", "currencyCode": "USD"}
        with self.assertRaisesRegex(ValueError, "monetary detail is missing"):
            build_components(row)
