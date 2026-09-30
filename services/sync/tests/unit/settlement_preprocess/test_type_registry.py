"""Closed type admission, retained evidence, and publication failure boundaries."""

import json
import unittest
from dataclasses import fields
from pathlib import Path
from unittest.mock import patch

from ....src.allocation import AllocationCategory
from ....src.amazon.data_kiosk.economics_models import EconomicsCost
from ....src.settlement_preprocess.classification import classify_settlement_row
from ....src.settlement_preprocess.raw_report import prepare_settlement_report
from ....src.settlement_preprocess.retrocharges import RETROCHARGE_COMPONENTS
from ....src.settlement_preprocess.workflow import preprocess_settlement_acquisition
from ....src.transaction_types.data_kiosk import DATA_KIOSK_TYPES
from ....src.transaction_types.generate import OUTPUT_DIRECTORY, generated_catalogs
from ....src.transaction_types.settlement import SETTLEMENT_TYPES
from ...support.archives import MemoryArchiveStorage
from ...support.fakes import FakeDatabaseConnection
from ...support.source_preprocessing import settlement_acquisition, settlement_document

REPOSITORY = Path(__file__).resolve().parents[5]


class TransactionTypeRegistryTests(unittest.TestCase):
    def test_retained_real_source_audit_has_no_unknown_triples(self) -> None:
        audit = json.loads(
            (
                REPOSITORY / "docs/evidence/settlement_classification_audit_2026-09-08.json"
            ).read_text(encoding="utf-8")
        )
        signatures = audit["combined_strict"]["signatures"]
        signatures += audit["historical_supplemental"]["supplemental_all_27_diagnostic"][
            "new_unmatched_signatures"
        ]
        known = {definition.source_key for definition in SETTLEMENT_TYPES}
        for signature in signatures:
            key = tuple(
                signature[field]
                for field in ("transaction_type", "amount_type", "amount_description")
            )
            with self.subTest(component=key):
                self.assertIn(key, known)

    def test_arbitrary_descriptions_are_rejected_in_every_known_family(self) -> None:
        for definition in SETTLEMENT_TYPES:
            with self.subTest(component=definition.source_key), self.assertRaises(ValueError):
                classify_settlement_row(
                    {
                        "transaction-type": definition.transaction_type,
                        "amount-type": definition.amount_type,
                        "amount-description": definition.description + " UNREVIEWED",
                        "marketplace-name": "Amazon.com",
                        "sku": "SKU-1",
                    }
                )

    def test_all_unknown_combinations_and_lines_are_reported_including_zero_amounts(self) -> None:
        document = settlement_document(
            {},
            {"amount-type": "ItemFees", "amount-description": "New fee", "amount": "0"},
            {"amount-type": "ItemFees", "amount-description": "New fee", "amount": "0"},
            {"transaction-type": "New family", "amount": "0"},
        )
        with self.assertRaises(ValueError) as raised:
            prepare_settlement_report(document)
        message = str(raised.exception)
        self.assertIn("New fee", message)
        self.assertIn("source lines [4, 5]", message)
        self.assertIn("New family", message)
        self.assertIn("source lines [6]", message)

    def test_unknown_late_row_never_publishes_a_partial_report(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = settlement_acquisition(
            settlement_document({}, {"amount-description": "Unreviewed principal"}), storage
        )
        database = FakeDatabaseConnection()
        with (
            patch(
                "services.sync.src.settlement_preprocess.workflow.load_settlement_acquisition",
                return_value=acquisition,
            ),
            patch(
                "services.sync.src.settlement_preprocess.workflow.current_settlement_versions",
                return_value={},
            ),
            patch("services.sync.src.settlement_preprocess.workflow.publish_settlement") as publish,
            self.assertLogs("services.sync.src.settlement_preprocess.workflow", level="ERROR"),
            self.assertRaisesRegex(ValueError, "Unsupported Settlement types"),
        ):
            preprocess_settlement_acquisition(database, storage, str(acquisition.id))
        publish.assert_not_called()
        self.assertEqual(len(storage.objects), 1)

    def test_registry_has_unique_keys_and_all_five_analysis_cost_types(self) -> None:
        self.assertEqual(len(SETTLEMENT_TYPES), len({item.source_key for item in SETTLEMENT_TYPES}))
        self.assertEqual(
            len(SETTLEMENT_TYPES), len({item.component_type for item in SETTLEMENT_TYPES})
        )
        self.assertEqual(
            len(DATA_KIOSK_TYPES), len({item.component_type for item in DATA_KIOSK_TYPES})
        )
        self.assertEqual(
            {
                item.component_type
                for item in DATA_KIOSK_TYPES
                if item.category is AllocationCategory.ANALYSIS_ONLY
            },
            {
                "COST_OF_GOODS_SOLD",
                "SHIPPING_TO_AMAZON_COST",
                "MFN_FULFILLMENT_COST",
                "MFN_STORAGE_COST",
                "MISCELLANEOUS_COST",
            },
        )

    def test_checked_in_frontend_catalogs_are_current(self) -> None:
        for name, content in generated_catalogs().items():
            with self.subTest(artifact=name):
                self.assertEqual((OUTPUT_DIRECTORY / name).read_text(encoding="utf-8"), content)

    def test_analysis_and_retrocharge_validation_cannot_drift_from_the_catalog(self) -> None:
        self.assertEqual(
            {field.name.upper() for field in fields(EconomicsCost)},
            {item.component_type for item in DATA_KIOSK_TYPES if item.collection == "cost"},
        )
        expected_retrocharges = {
            (transaction, amount_type, description)
            for transaction in ("Order_Retrocharge", "Refund_Retrocharge")
            for amount_type, description in RETROCHARGE_COMPONENTS
        }
        self.assertEqual(
            expected_retrocharges,
            {item.source_key for item in SETTLEMENT_TYPES if item.family == "F7"},
        )
