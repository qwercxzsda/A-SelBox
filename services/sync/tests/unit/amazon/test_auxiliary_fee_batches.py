"""Tests for transient, source-neutral auxiliary fee batches."""

import unittest
from dataclasses import replace
from datetime import date
from hashlib import sha256

from ....src.amazon.auxiliary_fees import (
    AuxiliaryFeeBatch,
    AuxiliaryFeeObservation,
    AuxiliaryFeeSource,
)
from ....src.amazon.marketplaces import CREDENTIAL_SCOPES
from ....src.numeric import Numeric

DEFAULT_SOURCE_START_DATE = date(2026, 8, 1)
DEFAULT_SOURCE_END_DATE = date(2026, 8, 2)


def _observation() -> AuxiliaryFeeObservation:
    reference = "removal-order-1"
    return AuxiliaryFeeObservation(
        source_system=AuxiliaryFeeSource.FBA_REPORT,
        observed_start_date=date(2026, 8, 1),
        observed_end_date=date(2026, 8, 1),
        marketplace_id="ATVPDKIKX0DER",
        category_code="DISPOSAL_FEES",
        amz_sku="SKU-1",
        currency="USD",
        reported_amount=Numeric("1.0000000000000000001"),
        normalized_amount=Numeric("-1.0000000000000000001"),
        source_reference_hash=sha256(reference.encode()).hexdigest(),
        source_grain={"source_line": 2},
        taxonomy={"order_type": "Disposal"},
        removal_order_id=reference,
    )


def _batch(
    *,
    amazon_scope: str = "NA",
    marketplace_id: str = "ATVPDKIKX0DER",
    source_start_date: date = DEFAULT_SOURCE_START_DATE,
    observations: tuple[AuxiliaryFeeObservation, ...] = (),
) -> AuxiliaryFeeBatch:
    return AuxiliaryFeeBatch(
        settlement_report_id="settlement-1",
        source_system=AuxiliaryFeeSource.FBA_REPORT,
        seller_namespace="seller-1",
        amazon_scope=amazon_scope,
        marketplace_id=marketplace_id,
        source_start_date=source_start_date,
        source_end_date=DEFAULT_SOURCE_END_DATE,
        observations=observations,
    )


class TestAuxiliaryFeeBatches(unittest.TestCase):
    def test_accepts_every_configured_marketplace_scope_pair(self) -> None:
        for scope_name, scope in CREDENTIAL_SCOPES.items():
            for marketplace_id in scope.marketplace_ids:
                with self.subTest(scope=scope_name, marketplace=marketplace_id):
                    batch = _batch(
                        amazon_scope=scope_name,
                        marketplace_id=marketplace_id,
                    )

                self.assertEqual(batch.amazon_scope, scope_name)
                self.assertEqual(batch.marketplace_id, marketplace_id)

    def test_rejects_every_cross_scope_pair_without_reflecting_values(self) -> None:
        for scope_name in CREDENTIAL_SCOPES:
            for foreign_scope_name, foreign_scope in CREDENTIAL_SCOPES.items():
                if foreign_scope_name == scope_name:
                    continue
                for marketplace_id in foreign_scope.marketplace_ids:
                    with (
                        self.subTest(scope=scope_name, marketplace=marketplace_id),
                        self.assertRaises(ValueError) as raised,
                    ):
                        _batch(
                            amazon_scope=scope_name,
                            marketplace_id=marketplace_id,
                        )

                    error_text = str(raised.exception)
                    self.assertNotIn(scope_name, error_text)
                    self.assertNotIn(marketplace_id, error_text)

    def test_rejects_unknown_scope_and_marketplace_without_reflecting_values(self) -> None:
        private_scope = "PRIVATE_SCOPE_VALUE"
        private_marketplace = "PRIVATE_MARKETPLACE_VALUE"

        for amazon_scope, marketplace_id in (
            (private_scope, CREDENTIAL_SCOPES["NA"].marketplace_ids[0]),
            ("NA", private_marketplace),
        ):
            with (
                self.subTest(scope=amazon_scope, marketplace=marketplace_id),
                self.assertRaises(ValueError) as raised,
            ):
                _batch(amazon_scope=amazon_scope, marketplace_id=marketplace_id)

            error_text = str(raised.exception)
            self.assertNotIn(amazon_scope, error_text)
            self.assertNotIn(marketplace_id, error_text)

    def test_preserves_arbitrary_precision_amounts(self) -> None:
        batch = _batch(observations=(_observation(),))

        self.assertEqual(
            batch.observations[0].normalized_amount,
            Numeric("-1.0000000000000000001"),
        )

    def test_rejects_duplicate_observation_identity(self) -> None:
        observation = _observation()

        with self.assertRaisesRegex(ValueError, "must be unique"):
            _batch(observations=(observation, observation))

    def test_rejects_removal_order_id_on_nonremoval_observation(self) -> None:
        with self.assertRaisesRegex(ValueError, "only for FBA removal"):
            replace(_observation(), category_code="FBA_STORAGE_FEES")

    def test_requires_removal_order_id_on_removal_observation(self) -> None:
        with self.assertRaisesRegex(ValueError, "require removal_order_id"):
            replace(_observation(), removal_order_id=None)

    def test_normalized_amount_must_negate_reported_amount(self) -> None:
        with self.assertRaisesRegex(ValueError, "must negate reported_amount"):
            replace(_observation(), normalized_amount=Numeric("1.0000000000000000001"))

    def test_rejects_observation_outside_batch_source_period(self) -> None:
        with self.assertRaisesRegex(ValueError, "contained by the batch source period"):
            _batch(
                source_start_date=date(2026, 8, 2),
                observations=(_observation(),),
            )

    def test_copies_nested_observation_provenance(self) -> None:
        source_lines = [2]
        observation = replace(
            _observation(),
            source_grain={"source_lines": source_lines},
        )

        source_lines.append(3)

        self.assertEqual(observation.source_grain, {"source_lines": (2,)})


if __name__ == "__main__":
    unittest.main()
