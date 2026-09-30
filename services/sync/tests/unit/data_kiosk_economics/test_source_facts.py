"""Complete archived observations, component authority, and semantic comparison."""

import unittest
from dataclasses import replace
from datetime import date
from unittest.mock import patch

from ....src.allocation import AllocationCategory
from ....src.amazon.data_kiosk.errors import DataKioskHelperError
from ....src.data_kiosk_economics.components import (
    build_components,
)
from ....src.data_kiosk_economics.errors import UnresolvedDataKioskComponentError
from ....src.data_kiosk_economics.preprocess import prepare_data_kiosk_acquisition
from ....src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from ....src.numeric import Numeric
from ...support.archives import MemoryArchiveStorage
from ...support.economics import (
    complete_economics_document,
    complete_economics_fact,
    economics_fee,
)
from ...support.fakes import FakeDatabaseConnection
from ...support.source_preprocessing import kiosk_acquisition


class DataKioskSourceFactsTests(unittest.TestCase):
    def test_archived_sku_text_remains_distinct_in_company_cost_components(self) -> None:
        skus = ("SKU-1", " SKU-1", "SKU-1 ", 'SKU-"1"', "SKU-\\1", "상품-1")
        document = b"".join(
            complete_economics_document(msku=sku, fees=f"[{economics_fee('DisposalFee')}]")
            for sku in skus
        )
        storage = MemoryArchiveStorage()
        days = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, document), storage)
        costs = [row for row in days[0].transactions if row.category == "DATA_KIOSK"]
        self.assertEqual({row.sku for row in costs}, set(skus))
        self.assertEqual(len(costs), len(skus))
        self.assertTrue(all(row.amount == Numeric(-6) for row in costs))
        self.assertEqual(days[1].transactions, ())

    def test_one_sku_retains_sales_and_storage_with_independent_component_authority(self) -> None:
        storage = MemoryArchiveStorage()
        document = complete_economics_document(
            fees=(
                f"[{economics_fee('DisposalFee')},"
                f"{economics_fee('ReferralFee', identifier='fee-2')}]"
            )
        )
        acquisition = kiosk_acquisition(storage, document)
        days = prepare_data_kiosk_acquisition(acquisition, storage)
        self.assertEqual([len(day.transactions) for day in days], [3, 0])
        by_type = {row.component_type: row for row in days[0].transactions}
        self.assertEqual(by_type["NET_PRODUCT_SALES"].category, "SETTLEMENT")
        self.assertEqual(by_type["REFERRAL_FEE"].category, AllocationCategory.SETTLEMENT)
        self.assertEqual(by_type["DISPOSAL_FEE"].category, "DATA_KIOSK")
        self.assertEqual(by_type["DISPOSAL_FEE"].amount, Numeric(-6))
        self.assertEqual(days[0].marketplace_name, "Amazon.com")
        self.assertEqual(days[1].activity_date, date(2026, 8, 2))

    def test_unknown_fee_amounts_fail_before_publication_and_keep_archives(self) -> None:
        for amount in ("-6", "0", "6"):
            with self.subTest(amount=amount):
                storage = MemoryArchiveStorage()
                good = complete_economics_document(msku="GOOD-SKU")
                bad = complete_economics_document(
                    msku="PRIVATE-SKU", fees=f"[{economics_fee('UnknownFee', amount=amount)}]"
                )
                acquisition = kiosk_acquisition(storage, good + bad)
                archived = storage.objects.copy()
                with (
                    patch(
                        "services.sync.src.data_kiosk_economics.workflow.load_data_kiosk_acquisition",
                        return_value=acquisition,
                    ),
                    patch(
                        "services.sync.src.data_kiosk_economics.workflow.current_data_kiosk_versions",
                        return_value={"2026-08-01": "previous-version"},
                    ),
                    patch(
                        "services.sync.src.data_kiosk_economics.workflow.publish_data_kiosk"
                    ) as publish,
                    self.assertLogs(
                        "services.sync.src.data_kiosk_economics.workflow", level="ERROR"
                    ),
                    self.assertRaises(UnresolvedDataKioskComponentError) as raised,
                ):
                    preprocess_data_kiosk_acquisition(
                        FakeDatabaseConnection(), storage, str(acquisition.id)
                    )
                publish.assert_not_called()
                self.assertEqual(storage.objects, archived)
                self.assertEqual(raised.exception.source_line_number, 2)
                self.assertEqual(raised.exception.label, "UnknownFee")
                self.assertEqual(raised.exception.diagnostic_code, "DATA_KIOSK_UNKNOWN_FEE")
                self.assertNotIn("PRIVATE-SKU", str(raised.exception))
                self.assertNotIn("UnknownFee", str(raised.exception))

    def test_null_ad_charge_fails_instead_of_becoming_a_zero_amount(self) -> None:
        storage = MemoryArchiveStorage()
        document = complete_economics_document(
            ads='[{"adTypeName":"Sponsored Products charge","charge":null}]'
        )
        with self.assertRaises(UnresolvedDataKioskComponentError) as raised:
            prepare_data_kiosk_acquisition(kiosk_acquisition(storage, document), storage)
        self.assertEqual(raised.exception.reason, "MISSING_AD_CHARGE")
        self.assertEqual(raised.exception.source_line_number, 1)

    def test_account_component_with_msku_aborts_instead_of_excluding_or_charging_it(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = kiosk_acquisition(
            storage, complete_economics_document(fees=f"[{economics_fee('SubscriptionFee')}]")
        )
        with self.assertRaisesRegex(ValueError, "MSKU cannot use the SELBOX category"):
            prepare_data_kiosk_acquisition(acquisition, storage)

        row = build_components(complete_economics_fact())[0]
        with self.assertRaisesRegex(ValueError, "MSKU cannot use the SELBOX category"):
            replace(row, category=AllocationCategory.SELBOX)

    def test_null_required_collections_fail_preprocessing(self) -> None:
        for document, reason in (
            (complete_economics_document(ads="null"), "MISSING_ADS"),
            (
                complete_economics_document(fees='[{"feeTypeName":"DisposalFee","charges":null}]'),
                "MISSING_FEE_CHARGES",
            ),
        ):
            storage = MemoryArchiveStorage()
            with (
                self.subTest(reason=reason),
                self.assertRaises(UnresolvedDataKioskComponentError) as raised,
            ):
                prepare_data_kiosk_acquisition(kiosk_acquisition(storage, document), storage)
            self.assertEqual(raised.exception.reason, reason)
            self.assertEqual(raised.exception.source_line_number, 1)

    def test_signed_unit_counts_are_preserved(self) -> None:
        document = complete_economics_document().replace(b'"netUnitsSold":0', b'"netUnitsSold":-1')
        document = document.replace(b'"unitsRefunded":0', b'"unitsRefunded":1')
        storage = MemoryArchiveStorage()
        day = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, document), storage)[0]
        self.assertEqual(day.transactions[0].quantity, Numeric(-1))

    def test_complete_pages_publish_empty_days_and_row_order_does_not_change_contents(self) -> None:
        storage = MemoryArchiveStorage()
        first = complete_economics_document(msku="SKU-1")
        second = complete_economics_document(msku="SKU-2")
        a = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, first, second), storage)
        b = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, second + first), storage)
        self.assertEqual([day.content_sha256 for day in a], [day.content_sha256 for day in b])
        empty = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, None), storage)
        self.assertEqual(len(empty), 2)
        self.assertTrue(all(not day.transactions for day in empty))
        self.assertNotEqual(a[0].content_sha256, empty[0].content_sha256)
        disappeared = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, first), storage)
        self.assertEqual({row.sku for row in disappeared[0].transactions}, {"SKU-1"})

    def test_partial_schema_scope_and_duplicate_pages_fail_without_publishing(self) -> None:
        storage = MemoryArchiveStorage()
        document = complete_economics_document()
        acquisition = kiosk_acquisition(storage, document)
        for invalid in (
            replace(
                acquisition,
                query_definition=acquisition.query_definition.replace(
                    "productId: MSKU", "productId: ASIN"
                ),
            ),
            replace(
                acquisition,
                query_definition=acquisition.query_definition.replace(
                    "marketplaceIds:", 'mskus: ["SKU-1"] marketplaceIds:'
                ),
            ),
            replace(acquisition, schema_version="economicsPreview"),
            kiosk_acquisition(storage, document.replace(b'"ads":[],', b"")),
            kiosk_acquisition(
                storage,
                document.replace(
                    b'"marketplaceId":"ATVPDKIKX0DER"', b'"marketplaceId":"A2EUQ1WTGCTBG2"'
                ),
            ),
            kiosk_acquisition(storage, document, document),
            kiosk_acquisition(storage, document.replace(b'"2026-08-01"', b'"2026-08-03"')),
        ):
            with (
                self.subTest(acquisition_id=invalid.id),
                self.assertRaises((ValueError, DataKioskHelperError)),
            ):
                prepare_data_kiosk_acquisition(invalid, storage)

    def test_no_data_requires_verified_terminal_query_evidence(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = kiosk_acquisition(storage, None)
        for overrides in (
            {"query": "query { incomplete }"},
            {"createdTime": "2020-01-01T00:00:00Z"},
            {"errorDocumentId": "error"},
            {"pagination": {"nextToken": "missing-page"}},
        ):
            page = replace(
                acquisition.pages[0],
                api_metadata={**acquisition.pages[0].api_metadata, **overrides},
            )
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                prepare_data_kiosk_acquisition(replace(acquisition, pages=(page,)), storage)
        with self.assertRaisesRegex(ValueError, "unfinished"):
            prepare_data_kiosk_acquisition(
                kiosk_acquisition(storage, None, end_date=date(2026, 9, 2)), storage
            )

    def test_offline_workflow_uses_saved_inputs_with_network_disabled(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = kiosk_acquisition(storage, complete_economics_document())
        database = FakeDatabaseConnection()
        with (
            patch(
                "services.sync.src.data_kiosk_economics.workflow.load_data_kiosk_acquisition",
                return_value=acquisition,
            ),
            patch(
                "services.sync.src.data_kiosk_economics.workflow.current_data_kiosk_versions",
                return_value={},
            ),
            patch(
                "services.sync.src.data_kiosk_economics.workflow.publish_data_kiosk",
                return_value="batch-one",
            ) as publish,
            patch("socket.create_connection", side_effect=AssertionError("Network unavailable")),
        ):
            self.assertEqual(
                preprocess_data_kiosk_acquisition(database, storage, str(acquisition.id)),
                "batch-one",
            )
            self.assertEqual(len(publish.call_args.args[2]), 2)
            publish.reset_mock()
            storage.objects.clear()
            with (
                self.assertLogs("services.sync.src.data_kiosk_economics.workflow", level="ERROR"),
                self.assertRaises(KeyError),
            ):
                preprocess_data_kiosk_acquisition(database, storage, str(acquisition.id))
            publish.assert_not_called()
