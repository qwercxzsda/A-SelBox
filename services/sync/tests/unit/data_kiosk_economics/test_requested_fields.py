"""Incomplete selections cannot silently become nullable or empty source values."""

import unittest

from ....src.data_kiosk_economics.preprocess import prepare_data_kiosk_acquisition
from ...support.archives import MemoryArchiveStorage
from ...support.economics import complete_economics_document, economics_fee
from ...support.source_preprocessing import kiosk_acquisition


class RequestedFieldsTests(unittest.TestCase):
    def test_missing_or_unselected_nested_fields_fail_before_normalization(self) -> None:
        document = complete_economics_document(fees=f"[{economics_fee('DisposalFee')}]")
        for field, original, replacement in (
            ("sales", b'"averageSellingPrice":null,', b""),
            ("fee", b'"properties":[],', b""),
            ("detail", b'"amountPerUnitDelta":null,', b""),
            ("money", b'"amount":0,"currencyCode"', b'"currencyCode"'),
            ("extra", b'"cost":null,', b'"cost":null,"unselectedField":1,'),
            ("collection", b'"components":[]', b'"components":{}'),
        ):
            with self.subTest(field=field):
                storage = MemoryArchiveStorage()
                incomplete = document.replace(original, replacement, 1)
                with self.assertRaises(ValueError) as raised:
                    prepare_data_kiosk_acquisition(kiosk_acquisition(storage, incomplete), storage)
                self.assertIn(
                    "Data Kiosk source_document_id=doc-1; source_line=1.",
                    raised.exception.__notes__,
                )

    def test_omitting_nested_cost_is_distinct_from_a_selected_null_cost(self) -> None:
        cost = (
            b'"cost":{"costOfGoodsSold":null,"miscellaneousCost":null,'
            b'"fbaCost":{"shippingToAmazonCost":null},'
            b'"mfnCost":{"fulfillmentCost":null,"storageCost":null}}'
        )
        document = complete_economics_document().replace(b'"cost":null', cost)
        storage = MemoryArchiveStorage()
        days = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, document), storage)
        self.assertEqual(len(days[0].transactions), 1)
        incomplete = document.replace(b',"storageCost":null', b"")
        with self.assertRaisesRegex(ValueError, "pinned query"):
            prepare_data_kiosk_acquisition(kiosk_acquisition(storage, incomplete), storage)
