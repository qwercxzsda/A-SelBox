import unittest

from ...src.transaction_types.finances import classify_finances_component


class SourceRouteTests(unittest.TestCase):
    def test_native_inbound_convenience_paths_keep_the_registered_component_type(self) -> None:
        for prefix in (
            ("AmazonFees", "FBAInboundConvenienceFee"),
            ("FBAFees", "FBAInboundConvenienceFee"),
            ("FBAFees", "InboundConvenienceCharge", "FBAInboundConvenienceFee"),
        ):
            for detail in ("Base", "Tax"):
                with self.subTest(path=(*prefix, detail)):
                    result = classify_finances_component("ServiceFee", (*prefix, detail))
                    self.assertEqual(result.component_type, "INBOUND_PLACEMENT_FEES")
                    self.assertEqual(result.route, "SHIPMENT")

    def test_cross_account_adjustment_without_a_wrapper_is_a_balance_movement(self) -> None:
        adjustment = classify_finances_component("Adjustment", ("CrossAccountDebtAdjustment",))
        self.assertEqual(
            (adjustment.route, adjustment.selbox_group), ("SELBOX", "BALANCE_MOVEMENT")
        )

    def test_unknown_paths_cannot_become_generic_account_adjustments(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported Finances"):
            classify_finances_component("ServiceFee", ("AmazonFees", "UnknownCharge", "Base"))

    def test_parent_tax_and_base_keep_same_route(self) -> None:
        for detail in ("Base", "Tax"):
            self.assertEqual(
                classify_finances_component(
                    "ServiceFee", ("AmazonFees", "FBAStorageFee", detail)
                ).route,
                "STORAGE",
            )
