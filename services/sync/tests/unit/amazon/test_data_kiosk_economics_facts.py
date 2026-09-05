"""Tests for complete, exact Data Kiosk daily MSKU facts."""

import unittest
from datetime import date
from decimal import localcontext

from ....src.amazon.data_kiosk import DataKioskEconomicsNormalizationError
from ....src.amazon.data_kiosk.document_processing import parse_jsonl_source_document
from ....src.amazon.data_kiosk.economics_fact_normalization import (
    normalize_parsed_daily_msku_economics_facts,
)
from ....src.amazon.data_kiosk.economics_normalization import (
    derive_economics_fee_observations,
)
from ....src.numeric import Numeric, NumericBoundError


def _required[Value](value: Value | None) -> Value:
    if value is None:
        raise AssertionError("The fixture value must not be null.")
    return value


def _aggregated_detail(
    *,
    amount: str = "6.125000000000000000000000001",
    amount_per_unit: str = "2.4500000000000000000000000004",
    quantity: str = "2.5",
    total: str = "6.225000000000000000000000001",
) -> str:
    return (
        '{"amount":{"amount":'
        f"{amount}"
        ',"currencyCode":"USD"},'
        '"amountPerUnit":{"amount":'
        f"{amount_per_unit}"
        ',"currencyCode":"USD"},'
        '"amountPerUnitDelta":null,'
        '"promotionAmount":{"amount":0.100,"currencyCode":"USD"},'
        f'"quantity":{quantity},'
        '"taxAmount":{"amount":0.200,"currencyCode":"USD"},'
        '"totalAmount":{"amount":'
        f"{total}"
        ',"currencyCode":"USD"}}'
    )


def _complete_document(
    *,
    units_ordered: str = "3",
    units_refunded: str = "1",
    net_units_sold: str = "2",
    ordered_product_sales: str = "30.375",
    refunded_product_sales: str = "10.125",
    net_product_sales: str = "20.25",
) -> bytes:
    fee_detail = _aggregated_detail()
    component_detail = _aggregated_detail(
        amount="5.000",
        amount_per_unit="2.000",
        quantity="2.5",
        total="5.100",
    )
    ad_detail = _aggregated_detail(
        amount="0.9000000000000000000000000001",
        amount_per_unit="0.30000000000000000000000000003333333333333333333333",
        quantity="3",
        total="1.0000000000000000000000000001",
    )
    return (
        '{"startDate":"2026-08-01","endDate":"2026-08-01",'
        '"marketplaceId":"ATVPDKIKX0DER","msku":"PRIVATE-SKU-1",'
        '"childAsin":"B000PRIVATE","fnsku":null,"parentAsin":"B000PARENT",'
        '"sales":{'
        '"averageSellingPrice":{"amount":10.123456789012345678901,"currencyCode":"USD"},'
        f'"netProductSales":{{"amount":{net_product_sales},"currencyCode":"USD"}},'
        f'"netUnitsSold":{net_units_sold},'
        f'"orderedProductSales":{{"amount":{ordered_product_sales},'
        '"currencyCode":"USD"},'
        f'"refundedProductSales":{{"amount":{refunded_product_sales},'
        '"currencyCode":"USD"},'
        f'"unitsOrdered":{units_ordered},"unitsRefunded":{units_refunded}}},'
        '"fees":[{"feeTypeName":"MonthlyInventoryStorageFee","charges":[{'
        '"identifier":"private-storage-charge","startDate":"2026-08-01",'
        '"endDate":"2026-08-01",'
        '"properties":[{"propertyName":"Product Size Tier",'
        '"propertyValue":"private-tier"}],'
        f'"aggregatedDetail":{fee_detail},'
        '"components":[{"name":"Base storage fee",'
        '"properties":[{"propertyName":"Volume","propertyValue":"private-volume"}],'
        f'"aggregatedDetail":{component_detail}}}'
        "]}] }],"
        '"ads":[{"adTypeName":"Sponsored Products charge","charge":'
        f"{ad_detail}"
        '},{"adTypeName":"Unclassified advertising charge","charge":null}],'
        '"cost":{"costOfGoodsSold":{"amount":4.125,"currencyCode":"USD"},'
        '"fbaCost":{"shippingToAmazonCost":{"amount":0.625,"currencyCode":"USD"}},'
        '"mfnCost":{"fulfillmentCost":{"amount":1.25,"currencyCode":"USD"},'
        '"storageCost":null},'
        '"miscellaneousCost":{"amount":0.3333333333333333333333333333,'
        '"currencyCode":"USD"}},'
        '"netProceeds":{"perUnit":{"amount":5.500000000000000000001,'
        '"currencyCode":"USD"},"total":{"amount":11.000000000000000000002,'
        '"currencyCode":"USD"}}}\n'
    ).encode()


def _nullable_document() -> bytes:
    zero_amount = '{"amount":0,"currencyCode":"USD"}'
    aggregated_detail = (
        f'{{"amount":{zero_amount},"amountPerUnit":null,"amountPerUnitDelta":null,'
        f'"promotionAmount":{zero_amount},"quantity":null,"taxAmount":{zero_amount},'
        f'"totalAmount":{zero_amount}}}'
    )
    return (
        '{"startDate":"2026-08-02","endDate":"2026-08-02",'
        '"marketplaceId":"ATVPDKIKX0DER","msku":"SKU-2",'
        '"childAsin":null,"fnsku":null,"parentAsin":"B000PARENT",'
        '"sales":{"averageSellingPrice":null,'
        f'"netProductSales":{zero_amount},"netUnitsSold":0,'
        f'"orderedProductSales":{zero_amount},"refundedProductSales":{zero_amount},'
        '"unitsOrdered":0,"unitsRefunded":0},'
        '"fees":[{"feeTypeName":"ReferralFees","charges":[{'
        '"identifier":"fee-2","startDate":null,"endDate":null,'
        f'"aggregatedDetail":{aggregated_detail},"components":null,"properties":null}}]}}],'
        '"ads":null,"cost":null,"netProceeds":{"perUnit":null,"total":null}}\n'
    ).encode()


def _replace_fees_field(document: bytes, replacement: bytes) -> bytes:
    fees_start = document.index(b'"fees":')
    ads_start = document.index(b'"ads":')
    return document[:fees_start] + replacement + document[ads_start:]


class TestDailyMskuEconomicsFacts(unittest.TestCase):
    def test_sales_preserve_numeric_bound_errors_for_workflow_diagnostics(self) -> None:
        documents = (
            _complete_document(net_product_sales="1e1000"),
            _complete_document(
                ordered_product_sales="1e999",
                refunded_product_sales="1e-1000",
                net_product_sales="0",
            ),
        )
        for index, document in enumerate(documents):
            with (
                self.subTest(case=index),
                self.assertRaises(NumericBoundError),
            ):
                normalize_parsed_daily_msku_economics_facts(
                    parse_jsonl_source_document(document),
                    source_document_id="document-1",
                )

    def test_normalizer_accepts_the_frozen_simple_parse_result(self) -> None:
        document = _complete_document()
        parsed_document = parse_jsonl_source_document(document)

        facts = normalize_parsed_daily_msku_economics_facts(
            parsed_document,
            source_document_id="document-1",
        )

        self.assertEqual(len(facts), 1)
        self.assertEqual(facts[0].source_line_number, 1)

    def test_normalizes_every_section_without_decimal_coercion(self) -> None:
        facts = normalize_parsed_daily_msku_economics_facts(
            parse_jsonl_source_document(_complete_document()),
            source_document_id="private-document-id",
        )

        self.assertEqual(len(facts), 1)
        fact = facts[0]
        self.assertEqual(fact.start_date, date(2026, 8, 1))
        self.assertEqual(fact.end_date, date(2026, 8, 1))
        self.assertEqual(fact.marketplace_id, "ATVPDKIKX0DER")
        self.assertEqual(fact.msku, "PRIVATE-SKU-1")
        self.assertEqual(
            fact.natural_key,
            ("ATVPDKIKX0DER", date(2026, 8, 1), date(2026, 8, 1), "PRIVATE-SKU-1"),
        )
        self.assertEqual(fact.child_asin, "B000PRIVATE")
        self.assertIsNone(fact.fnsku)
        self.assertEqual(fact.parent_asin, "B000PARENT")

        self.assertEqual(
            _required(fact.sales.average_selling_price).amount,
            Numeric("10.123456789012345678901"),
        )
        self.assertEqual(fact.sales.net_units_sold, Numeric("2"))
        self.assertEqual(fact.sales.units_ordered, Numeric("3"))
        self.assertEqual(fact.sales.units_refunded, Numeric("1"))

        fee = fact.fees[0]
        self.assertEqual(fee.fee_type_name, "MonthlyInventoryStorageFee")
        self.assertEqual(fee.start_date, date(2026, 8, 1))
        self.assertEqual(fee.end_date, date(2026, 8, 1))
        self.assertEqual(fee.properties[0].name, "Product Size Tier")
        self.assertEqual(fee.properties[0].value, "private-tier")
        self.assertEqual(fee.aggregated_detail.quantity, Numeric("2.5"))
        self.assertEqual(
            _required(fee.aggregated_detail.amount_per_unit).amount,
            Numeric("2.4500000000000000000000000004"),
        )
        self.assertEqual(fee.aggregated_detail.total_amount.currency_code, "USD")
        self.assertIsNone(fee.aggregated_detail.amount_per_unit_delta)
        self.assertEqual(fee.components[0].name, "Base storage fee")
        self.assertEqual(fee.components[0].aggregated_detail.total_amount.amount, Numeric("5.100"))

        self.assertEqual(len(fact.ads), 2)
        ad_charge = _required(fact.ads[0].charge)
        self.assertEqual(ad_charge.quantity, Numeric("3"))
        self.assertEqual(
            _required(ad_charge.amount_per_unit).amount,
            Numeric("0.30000000000000000000000000003333333333333333333333"),
        )
        self.assertIsNone(fact.ads[1].charge)

        cost = _required(fact.cost)
        self.assertEqual(_required(cost.cost_of_goods_sold).amount, Numeric("4.125"))
        self.assertEqual(_required(cost.shipping_to_amazon_cost).amount, Numeric("0.625"))
        self.assertEqual(_required(cost.mfn_fulfillment_cost).amount, Numeric("1.25"))
        self.assertIsNone(cost.mfn_storage_cost)
        self.assertEqual(
            _required(cost.miscellaneous_cost).amount,
            Numeric("0.3333333333333333333333333333"),
        )
        self.assertEqual(
            _required(fact.net_proceeds.total).amount,
            Numeric("11.000000000000000000002"),
        )
        self.assertNotIn("private-document-id", repr(fact))

    def test_complete_document_produces_auxiliary_fee_observations(self) -> None:
        facts = normalize_parsed_daily_msku_economics_facts(
            parse_jsonl_source_document(_complete_document()),
            source_document_id="private-document-id",
        )
        observations = derive_economics_fee_observations(facts)

        self.assertEqual(
            [item.category_code for item in observations],
            ["FBA_STORAGE_FEES", "SPONSORED_PRODUCTS_CHARGES"],
        )
        self.assertEqual(
            observations[0].reported_amount,
            Numeric("6.225000000000000000000000001"),
        )

    def test_preserves_nullable_sections_without_inventing_values(self) -> None:
        fact = normalize_parsed_daily_msku_economics_facts(
            parse_jsonl_source_document(_nullable_document()),
            source_document_id="document-2",
        )[0]

        self.assertIsNone(fact.sales.average_selling_price)
        self.assertEqual(fact.ads, ())
        self.assertIsNone(fact.cost)
        self.assertIsNone(fact.net_proceeds.per_unit)
        self.assertIsNone(fact.net_proceeds.total)
        self.assertIsNone(fact.fees[0].aggregated_detail.quantity)
        self.assertIsNone(fact.fees[0].aggregated_detail.amount_per_unit)
        self.assertIsNone(fact.fees[0].start_date)
        self.assertIsNone(fact.fees[0].end_date)
        self.assertEqual(fact.fees[0].components, ())
        self.assertEqual(fact.fees[0].properties, ())

    def test_rejects_nonintegral_long_without_exposing_source_value(self) -> None:
        with self.assertRaises(DataKioskEconomicsNormalizationError) as raised:
            normalize_parsed_daily_msku_economics_facts(
                parse_jsonl_source_document(_complete_document(units_ordered="3.125")),
                source_document_id="private-document-id",
            )

        self.assertIn("sales.unitsOrdered", str(raised.exception))
        self.assertNotIn("3.125", str(raised.exception))

    def test_rejects_noncanonical_row_identities_without_trimming_or_exposure(self) -> None:
        replacements = (
            (
                b'"marketplaceId":"ATVPDKIKX0DER"',
                b'"marketplaceId":" ATVPDKIKX0DER "',
                "marketplaceId",
                " ATVPDKIKX0DER ",
            ),
            (
                b'"msku":"PRIVATE-SKU-1"',
                b'"msku":" PRIVATE-SKU-1 "',
                "msku",
                " PRIVATE-SKU-1 ",
            ),
        )
        for original, replacement, field_name, private_value in replacements:
            with self.subTest(field_name=field_name):
                with self.assertRaises(DataKioskEconomicsNormalizationError) as raised:
                    normalize_parsed_daily_msku_economics_facts(
                        parse_jsonl_source_document(
                            _complete_document().replace(original, replacement)
                        ),
                        source_document_id="private-document-id",
                    )

                self.assertIn(field_name, str(raised.exception))
                self.assertNotIn(private_value, str(raised.exception))

    def test_rejects_incoherent_sales_equations_and_negative_counts(self) -> None:
        cases = (
            (_complete_document(units_ordered="-1", net_units_sold="-2"), "unit counts"),
            (_complete_document(units_refunded="-1", net_units_sold="4"), "unit counts"),
            (_complete_document(net_units_sold="1"), "Net units sold"),
            (_complete_document(net_product_sales="20.24"), "Net product sales"),
        )
        for document, expected_message in cases:
            with (
                self.subTest(expected_message=expected_message),
                self.assertRaisesRegex(
                    DataKioskEconomicsNormalizationError,
                    "sales consistency",
                ),
            ):
                normalize_parsed_daily_msku_economics_facts(
                    parse_jsonl_source_document(document),
                    source_document_id="private-document-id",
                )

    def test_sales_equations_ignore_decimal_context_precision(self) -> None:
        ordered_units = "123456789012345678901234567890"
        net_units = "123456789012345678901234567889"
        ordered_sales = "12345678901234567890.12345678901234567890"
        refund = "0.00000000000000000001"
        net_sales = "12345678901234567890.12345678901234567889"

        with localcontext() as context:
            context.prec = 5
            fact = normalize_parsed_daily_msku_economics_facts(
                parse_jsonl_source_document(
                    _complete_document(
                        units_ordered=ordered_units,
                        units_refunded="1",
                        net_units_sold=net_units,
                        ordered_product_sales=ordered_sales,
                        refunded_product_sales=refund,
                        net_product_sales=net_sales,
                    )
                ),
                source_document_id="private-document-id",
            )[0]

        self.assertEqual(fact.sales.net_units_sold, Numeric(net_units))
        self.assertEqual(fact.sales.net_product_sales.amount, Numeric(net_sales))

    def test_sales_equation_rejects_a_context_rounded_false_match(self) -> None:
        with localcontext() as context:
            context.prec = 5
            with self.assertRaisesRegex(
                DataKioskEconomicsNormalizationError,
                "sales consistency",
            ):
                normalize_parsed_daily_msku_economics_facts(
                    parse_jsonl_source_document(
                        _complete_document(
                            ordered_product_sales=("12345678901234567890.123456789"),
                            refunded_product_sales="0.000000000000000000001",
                            net_product_sales="12346000000000000000",
                        )
                    ),
                    source_document_id="private-document-id",
                )

    def test_rejects_missing_or_null_required_fees_collection(self) -> None:
        document = _nullable_document()

        for case, replacement in (
            ("missing", b""),
            ("null", b'"fees":null,'),
        ):
            with self.subTest(case=case):
                with self.assertRaises(DataKioskEconomicsNormalizationError) as raised:
                    normalize_parsed_daily_msku_economics_facts(
                        parse_jsonl_source_document(_replace_fees_field(document, replacement)),
                        source_document_id="private-document-id",
                    )

                self.assertIn("fees", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
