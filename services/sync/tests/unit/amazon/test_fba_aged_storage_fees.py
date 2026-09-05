"""Tests for exact actual-charge FBA aged-storage normalization."""

import unittest

from ....src.amazon.auxiliary_fees import AuxiliaryFeeSource
from ....src.amazon.fba_reports.aged_storage_fees import (
    normalize_parsed_aged_storage_fee_document,
)
from ....src.amazon.fba_reports.parsing import parse_aged_storage_fee_document
from ....src.numeric import Numeric


def _document(*rows: tuple[str, ...], encoding: str = "cp932") -> bytes:
    header = (
        "snapshot-date",
        "sku",
        "fnsku",
        "asin",
        "product-name",
        "condition",
        "per-unit-volume",
        "currency",
        "volume-unit",
        "country",
        "qty-charged",
        "amount-charged",
        "surcharge-age-tier",
        "rate-surcharge",
    )
    text = "\n".join(("\t".join(header), *("\t".join(row) for row in rows))) + "\n"
    return text.encode(encoding)


def _row(
    *,
    snapshot_date: str = "2026-08-15",
    sku: str = "SKU-A",
    amount: str = "1.234567890123456789",
    currency: str = "eur",
) -> tuple[str, ...]:
    return (
        snapshot_date,
        sku,
        "FNSKU-A",
        "ASIN-A",
        "Product",
        "New",
        "0.125",
        currency,
        "cubic-meter",
        "DE",
        "2",
        amount,
        "365-455 days",
        "0.987654321",
    )


class TestFbaAgedStorageFeeNormalization(unittest.TestCase):
    def test_simple_parser_does_not_validate_date_currency_or_amount(self) -> None:
        parsed = parse_aged_storage_fee_document(
            _document(
                _row(
                    snapshot_date="not-a-date",
                    amount="-0.01",
                    currency="US-DOLLAR",
                )
            ),
            amazon_scope="EU",
        )

        self.assertEqual(parsed.rows[0].values[0], "not-a-date")
        self.assertEqual(parsed.rows[0].values[7], "US-DOLLAR")
        self.assertEqual(parsed.rows[0].values[11], "-0.01")
        with self.assertRaisesRegex(ValueError, "must not be negative"):
            normalize_parsed_aged_storage_fee_document(
                parsed,
                marketplace_id="A1PA6795UKMFR9",
            )

    def test_decodes_live_japan_cp932_non_ascii_row_without_a_bom(self) -> None:
        document = _document(_row(sku="商品-SKU"))

        observations = normalize_parsed_aged_storage_fee_document(
            parse_aged_storage_fee_document(document, amazon_scope="JAPAN"),
            marketplace_id="A1VC38T7YXB528",
        )

        self.assertFalse(document.startswith(b"\xef\xbb\xbf"))
        self.assertEqual(observations[0].amz_sku, "商品-SKU")
        self.assertEqual(
            observations[0].reported_amount,
            Numeric("1.234567890123456789"),
        )

    def test_decodes_live_eu_utf8_non_ascii_row(self) -> None:
        observations = normalize_parsed_aged_storage_fee_document(
            parse_aged_storage_fee_document(
                _document(_row(sku="Café-SKU"), encoding="utf-8"),
                amazon_scope="EU",
            ),
            marketplace_id="A1PA6795UKMFR9",
        )

        self.assertEqual(observations[0].amz_sku, "Café-SKU")

    def test_preserves_exact_actual_charge_and_negates_once(self) -> None:
        observations = normalize_parsed_aged_storage_fee_document(
            parse_aged_storage_fee_document(_document(_row()), amazon_scope="EU"),
            marketplace_id="A1PA6795UKMFR9",
        )

        self.assertEqual(len(observations), 1)
        observation = observations[0]
        self.assertEqual(observation.source_system, AuxiliaryFeeSource.FBA_REPORT)
        self.assertEqual(observation.category_code, "FBA_AGED_INVENTORY_FEES")
        self.assertEqual(observation.amz_sku, "SKU-A")
        self.assertEqual(observation.currency, "EUR")
        self.assertEqual(observation.reported_amount, Numeric("1.234567890123456789"))
        self.assertEqual(observation.normalized_amount, Numeric("-1.234567890123456789"))
        self.assertEqual(
            observation.source_grain["grain"],
            "FBA_AGED_STORAGE_MSKU_REPORT_LINE",
        )
        self.assertIsNone(observation.removal_order_id)
        self.assertEqual(observation.source_grain["amount_field"], "amount-charged")
        self.assertEqual(observation.taxonomy["quantity_charged"], "2")
        self.assertEqual(len(observation.source_reference_hash), 64)

    def test_skips_blank_and_zero_amounts_without_fabricating_attribution(self) -> None:
        parsed = parse_aged_storage_fee_document(
            _document(_row(amount=""), _row(sku="SKU-B", amount="0.000")),
            amazon_scope="EU",
        )

        observations = normalize_parsed_aged_storage_fee_document(
            parsed,
            marketplace_id="A1PA6795UKMFR9",
        )

        self.assertEqual(len(parsed.rows), 2)
        self.assertEqual(observations, ())

    def test_rejects_negative_amount_because_live_source_sign_is_charge_positive(self) -> None:
        with self.assertRaisesRegex(ValueError, "must not be negative"):
            normalize_parsed_aged_storage_fee_document(
                parse_aged_storage_fee_document(
                    _document(_row(amount="-0.01")),
                    amazon_scope="EU",
                ),
                marketplace_id="A1PA6795UKMFR9",
            )

    def test_accepts_localized_decimal_and_rejects_missing_contract_columns(self) -> None:
        actual = normalize_parsed_aged_storage_fee_document(
            parse_aged_storage_fee_document(
                _document(_row(amount="0,125")),
                amazon_scope="EU",
            ),
            marketplace_id="A1PA6795UKMFR9",
        )
        self.assertEqual(actual[0].reported_amount, Numeric("0.125"))

        with self.assertRaisesRegex(ValueError, "missing required columns"):
            normalize_parsed_aged_storage_fee_document(
                parse_aged_storage_fee_document(
                    b"snapshot-date\tsku\tamount-charged\n2026-08-15\tSKU-A\t1\n",
                    amazon_scope="EU",
                ),
                marketplace_id="A1PA6795UKMFR9",
            )


if __name__ == "__main__":
    unittest.main()
