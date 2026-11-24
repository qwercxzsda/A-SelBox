"""Historical native bills retain complete money and the existing fee policy."""

import unittest
from typing import cast

from services.sync.src.finances.components import build_components
from services.sync.src.numeric import ZERO, Numeric
from services.sync.tests.support.currencies import CURRENCY_DECIMALS


def _money(amount: str, currency: str = "USD") -> dict[str, object]:
    return {"currencyAmount": amount, "currencyCode": currency}


def _leaf(path: tuple[str, ...], amount: str) -> dict[str, object]:
    result: dict[str, object] = {}
    for name in reversed(path):
        result = {
            "breakdownType": name,
            "breakdownAmount": _money(amount),
            **({"breakdowns": [result]} if result else {}),
        }
    return result


def _transaction(
    kind: str, amount: str, leaves: tuple[tuple[tuple[str, ...], str], ...], *, sku: bool = False
) -> dict[str, object]:
    item = {
        "totalAmount": _money(amount),
        "contexts": [{"contextType": "ProductContext", "sku": "SKU", "quantityShipped": 1}]
        if sku
        else [],
        "breakdowns": [_leaf(path, value) for path, value in leaves],
    }
    return {
        "sellingPartnerMetadata": {"marketplaceId": "ATVPDKIKX0DER"},
        "postedDate": "2026-10-19T18:00:00Z",
        "transactionId": "native-bill",
        "transactionType": kind,
        "totalAmount": _money(amount),
        "items": [item],
    }


class HistoricalComponentTests(unittest.TestCase):
    def test_unobserved_lightning_deal_id_shape_fails_closed(self) -> None:
        path = ("AmazonFees", "RunLightningDealFee", "Base")
        row = _transaction("SellerDealPayment", "-150", ((path, "-150"),))
        with self.assertRaisesRegex(ValueError, "Unsupported Finances monetary path"):
            build_components(row, CURRENCY_DECIMALS)

        for kind, unreviewed_path in (
            ("ServiceFee", path),
            ("SellerDealPayment", ("FBAFees", "RunLightningDealFee", "Base")),
            ("SellerDealPayment", ("AmazonFees", "RunLightningDealFee", "Tax")),
        ):
            with (
                self.subTest(kind=kind, path=unreviewed_path),
                self.assertRaisesRegex(ValueError, "Unsupported Finances monetary path"),
            ):
                build_components(
                    _transaction(kind, "-150", ((unreviewed_path, "-150"),)), CURRENCY_DECIMALS
                )

    def test_gift_wrap_bundle_preserves_tax_and_chargebacks_without_extra_commission(self) -> None:
        row = _transaction(
            "Shipment",
            "652",
            (
                (("ProductCharges", "OurPricePrincipal"), "873"),
                (("Tax", "OurPriceTax"), "87"),
                (("Points", "PointsGranted"), "-10"),
                (("AmazonFees", "FBAPerUnitFulfillmentFee", "Base"), "-202"),
                (("AmazonFees", "FBAPerUnitFulfillmentFee", "Tax"), "-20"),
                (("AmazonFees", "Commission", "Base"), "-76"),
                (("Other", "GiftwrapPrincipal"), "322"),
                (("Tax", "GiftwrapTax"), "32"),
                (("AmazonFees", "GiftwrapChargeback", "Base"), "-322"),
                (("AmazonFees", "GiftwrapChargeback", "Tax"), "-32"),
            ),
            sku=True,
        )
        components = build_components(row, CURRENCY_DECIMALS)
        gift = [c for c in components if c.component_type.startswith("GIFT_WRAP_")]
        self.assertEqual(len(gift), 4)
        self.assertEqual(sum((c.amount for c in gift), ZERO), ZERO)
        self.assertTrue(all(c.route == "SKU" for c in gift))
        self.assertTrue(all(c.fee_base is None and c.quantity is None for c in gift))
        self.assertEqual(sum((c.amount for c in components), ZERO), Numeric(652))
        self.assertEqual([c.fee_base for c in components if c.fee_base is not None], [Numeric(873)])

    def test_disposal_waiver_preserves_both_sides_of_the_zero_bill(self) -> None:
        row = _transaction(
            "ServiceFee",
            "0",
            (
                (("AmazonFees", "FBADisposalFee", "Base"), "-60"),
                (("AmazonFees", "FBADisposalFee", "Promo"), "60"),
            ),
        )
        components = build_components(row, CURRENCY_DECIMALS)
        self.assertEqual([c.amount for c in components], [Numeric(-60), Numeric(60)])
        self.assertTrue(all(c.component_type == "DISPOSAL_FEES" for c in components))
        self.assertTrue(all(c.route == "REMOVAL_ORDER" for c in components))

    def test_zero_aged_storage_item_does_not_erase_charged_siblings(self) -> None:
        row = _transaction(
            "ServiceFee",
            "-41.19",
            ((("FBAFees", "LongTermStorageFee", "FBALongTermStorageFee", "Base"), "-41.19"),),
        )
        row["description"] = "FBALongTermStorageBilling"
        items = cast(list[object], row["items"])
        items.append({"totalAmount": {"currencyAmount": 0, "currencyCode": None}, "breakdowns": []})
        components = build_components(row, CURRENCY_DECIMALS)
        self.assertEqual(len(components), 2)
        self.assertEqual(sum((c.amount for c in components), ZERO), Numeric("-41.19"))
        self.assertTrue(all(c.component_type == "AGED_STORAGE_FEES" for c in components))
        self.assertTrue(all(c.sku is None and c.fee_base is None for c in components))

    def test_vine_is_an_account_expense_without_invented_product_attribution(self) -> None:
        row = _transaction(
            "ServiceFee",
            "-200",
            ((("AmazonFees", "VineEnrollmentFee", "VineFee", "Base"), "-200"),),
        )
        component = build_components(row, CURRENCY_DECIMALS)[0]
        self.assertEqual((component.route, component.component_type), ("SELBOX", "VINE_FEES"))
        self.assertEqual(component.accounting_subtype, "ACCOUNT_FEE")
        self.assertIsNone(component.sku)
        self.assertIsNone(component.fee_base)

    def test_retrocharge_shipping_tax_remains_a_nonallocated_zero_partition(self) -> None:
        row = _transaction(
            "Retrocharge",
            "0",
            (
                (("Retrocharge", "BaseTax"), "0.50"),
                (("Retrocharge", "ShippingTax"), "0.16"),
                (("Tax", "MarketplaceFacilitatorTax-Principal"), "-0.50"),
                (("Tax", "MarketplaceFacilitatorTax-Shipping"), "-0.16"),
            ),
        )
        components = build_components(row, CURRENCY_DECIMALS)
        self.assertEqual(len(components), 4)
        self.assertEqual(sum((c.amount for c in components), ZERO), ZERO)
        self.assertTrue(all(c.route == "SELBOX" for c in components))

    def test_native_withholding_preserves_the_sign_without_creating_commission(self) -> None:
        for kind, path, amount in (
            ("RemovalShipment", ("Tax", "MarketplaceFacilitatorTax-Principal"), "-0.01"),
            ("Shipment", ("Tax", "LowValueGoodsTax-Shipping"), "-1.03"),
        ):
            with self.subTest(kind=kind):
                component = build_components(
                    _transaction(kind, amount, ((path, amount),), sku=True), CURRENCY_DECIMALS
                )[0]
                self.assertEqual(component.component_type, "TAX_WITHHELD")
                self.assertEqual(component.amount, Numeric(amount))
                self.assertIsNone(component.fee_base)
