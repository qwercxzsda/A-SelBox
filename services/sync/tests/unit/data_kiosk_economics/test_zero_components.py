"""Empty components are filtered after validation without losing daily coverage."""

import unittest
from dataclasses import replace
from datetime import date
from unittest.mock import patch

from ....src.data_kiosk_economics.components import build_components
from ....src.data_kiosk_economics.preprocess import prepare_data_kiosk_acquisition
from ....src.numeric import Numeric
from ...support.archives import MemoryArchiveStorage
from ...support.economics import (
    complete_economics_document,
    complete_economics_fact,
    economics_fee,
)
from ...support.source_preprocessing import kiosk_acquisition


class DataKioskZeroComponentTests(unittest.TestCase):
    def test_zero_components_preserve_coverage_and_match_empty_day_hashes(self) -> None:
        storage = MemoryArchiveStorage()
        document = complete_economics_document(
            fees=f"[{economics_fee('DisposalFee', amount='-0.00')}]"
        )
        acquisition = kiosk_acquisition(storage, document)
        archived = storage.objects.copy()
        days = prepare_data_kiosk_acquisition(acquisition, storage)
        self.assertEqual(storage.objects, archived)
        empty = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, None), storage)
        self.assertEqual(days, empty)
        self.assertEqual([day.activity_date for day in days], [date(2026, 8, 1), date(2026, 8, 2)])
        self.assertTrue(all(not day.transactions for day in days))

    def test_each_nonzero_calculation_input_is_retained_exactly(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = kiosk_acquisition(storage, complete_economics_document())
        component = replace(
            build_components(complete_economics_fact())[0],
            amount=Numeric(0),
            quantity=None,
            fee_base=None,
        )
        for field in ("amount", "quantity", "fee_base"):
            for value in (Numeric("0.000000000000000000001"), Numeric(-1)):
                with self.subTest(field=field, value=value):
                    row = replace(component, **{field: value})
                    with patch(
                        "services.sync.src.data_kiosk_economics.preprocess.build_components",
                        return_value=(row,),
                    ):
                        days = prepare_data_kiosk_acquisition(acquisition, storage)
                    self.assertEqual(days[0].transactions, (row,))

    def test_zero_net_sales_breakdown_remains_only_in_archive(self) -> None:
        storage = MemoryArchiveStorage()
        document = (
            complete_economics_document()
            .replace(b'"orderedProductSales":{"amount":0', b'"orderedProductSales":{"amount":100')
            .replace(b'"refundedProductSales":{"amount":0', b'"refundedProductSales":{"amount":100')
            .replace(b'"unitsOrdered":0,"unitsRefunded":0', b'"unitsOrdered":1,"unitsRefunded":1')
        )
        days = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, document), storage)
        empty = prepare_data_kiosk_acquisition(kiosk_acquisition(storage, None), storage)
        self.assertEqual(days, empty)

    def test_duplicate_zero_components_still_fail_validation(self) -> None:
        storage = MemoryArchiveStorage()
        fee = economics_fee("DisposalFee", amount="0")
        document = complete_economics_document(fees=f"[{fee},{fee}]")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            prepare_data_kiosk_acquisition(kiosk_acquisition(storage, document), storage)
