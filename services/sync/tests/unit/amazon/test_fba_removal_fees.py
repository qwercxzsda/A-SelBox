import unittest

from ....src.amazon.auxiliary_fees import AuxiliaryFeeSource
from ....src.amazon.fba_reports.parsing import parse_removal_fee_document
from ....src.amazon.fba_reports.removal_fees import (
    normalize_parsed_removal_fee_document,
)
from ....src.numeric import Numeric


def _document(*rows: tuple[str, ...]) -> bytes:
    header = (
        "request-date",
        "order-id",
        "order-type",
        "service-speed",
        "order-status",
        "last-updated-date",
        "sku",
        "fnsku",
        "disposition",
        "requested-quantity",
        "cancelled-quantity",
        "disposed-quantity",
        "shipped-quantity",
        "in-process-quantity",
        "removal-fee",
        "currency",
    )
    return ("\n".join(("\t".join(header), *("\t".join(row) for row in rows))) + "\n").encode()


class TestFbaRemovalFeeNormalization(unittest.TestCase):
    def test_simple_parser_does_not_interpret_order_type(self) -> None:
        parsed = parse_removal_fee_document(
            _document(
                (
                    "2026-08-03",
                    "removal-1",
                    "Recycle",
                    "Standard",
                    "Completed",
                    "2026-08-04",
                    "SKU-A",
                    "FNSKU-A",
                    "Unsellable",
                    "1",
                    "0",
                    "1",
                    "0",
                    "0",
                    "1.00",
                    "USD",
                )
            ),
            amazon_scope="NA",
        )

        self.assertEqual(parsed.rows[0].values[2], "Recycle")
        with self.assertRaisesRegex(ValueError, "order-type"):
            normalize_parsed_removal_fee_document(
                parsed,
                marketplace_id="ATVPDKIKX0DER",
            )

    def test_decodes_utf8_non_ascii_row(self) -> None:
        document = _document(
            (
                "2026-08-03",
                "removal-1",
                "Return",
                "Standard",
                "Completed",
                "2026-08-04",
                "商品-SKU",
                "FNSKU-A",
                "Sellable",
                "1",
                "0",
                "0",
                "1",
                "0",
                "1.25",
                "jpy",
            )
        )

        observation = normalize_parsed_removal_fee_document(
            parse_removal_fee_document(document, amazon_scope="JAPAN"),
            marketplace_id="A1VC38T7YXB528",
        )[0]

        self.assertEqual(observation.amz_sku, "商品-SKU")
        self.assertEqual(observation.reported_amount, Numeric("1.25"))

    def test_normalizes_exact_disposal_and_return_fee_rows(self) -> None:
        document = _document(
            (
                "2026-08-03T10:11:12+00:00",
                "removal-1",
                "Disposal",
                "Standard",
                "Completed",
                "2026-08-04T00:00:00+00:00",
                "SKU-A",
                "FNSKU-A",
                "Unsellable",
                "3",
                "0",
                "3",
                "0",
                "0",
                "1.234567890123456789",
                "usd",
            ),
            (
                "03.08.2026",
                "removal-2",
                "Return",
                "Standard",
                "Completed",
                "2026-08-04T00:00:00+00:00",
                "SKU-B",
                "FNSKU-B",
                "Sellable",
                "1",
                "0",
                "0",
                "1",
                "0",
                "0.25",
                "EUR",
            ),
        )

        observations = normalize_parsed_removal_fee_document(
            parse_removal_fee_document(document, amazon_scope="EU"),
            marketplace_id="A1PA6795UKMFR9",
        )

        self.assertEqual(len(observations), 2)
        disposal, removal = observations
        self.assertEqual(disposal.source_system, AuxiliaryFeeSource.FBA_REPORT)
        self.assertEqual(disposal.category_code, "DISPOSAL_FEES")
        self.assertEqual(disposal.reported_amount, Numeric("1.234567890123456789"))
        self.assertEqual(disposal.normalized_amount, Numeric("-1.234567890123456789"))
        self.assertEqual(disposal.currency, "USD")
        self.assertEqual(disposal.removal_order_id, "removal-1")
        self.assertEqual(removal.category_code, "REMOVAL_FEES")
        self.assertEqual(removal.reported_amount, Numeric("0.25"))
        self.assertEqual(removal.normalized_amount, Numeric("-0.25"))

    def test_ignores_blank_and_zero_fee_rows(self) -> None:
        document = _document(
            (
                "2026-08-03",
                "removal-1",
                "Disposal",
                "Standard",
                "Pending",
                "2026-08-03",
                "SKU-A",
                "FNSKU-A",
                "Unsellable",
                "1",
                "0",
                "0",
                "0",
                "1",
                "",
                "USD",
            ),
            (
                "2026-08-03",
                "removal-2",
                "Return",
                "Standard",
                "Completed",
                "2026-08-03",
                "SKU-B",
                "FNSKU-B",
                "Sellable",
                "1",
                "0",
                "0",
                "1",
                "0",
                "0",
                "USD",
            ),
        )

        self.assertEqual(
            normalize_parsed_removal_fee_document(
                parse_removal_fee_document(document, amazon_scope="NA"),
                marketplace_id="ATVPDKIKX0DER",
            ),
            (),
        )

    def test_explicit_return_type_is_not_reclassified_by_disposed_quantity(self) -> None:
        document = _document(
            (
                "2026-08-03",
                "removal-1",
                "Return",
                "Standard",
                "Completed",
                "2026-08-03",
                "SKU-A",
                "FNSKU-A",
                "Unsellable",
                "1",
                "0",
                "1",
                "0",
                "0",
                "1.00",
                "USD",
            )
        )

        observation = normalize_parsed_removal_fee_document(
            parse_removal_fee_document(document, amazon_scope="NA"),
            marketplace_id="ATVPDKIKX0DER",
        )[0]

        self.assertEqual(observation.category_code, "REMOVAL_FEES")

    def test_rejects_truncated_disposed_quantity_instead_of_fabricating_zero(self) -> None:
        header = (
            "request-date",
            "order-id",
            "order-type",
            "sku",
            "removal-fee",
            "currency",
            "disposed-quantity",
        )
        truncated_row = (
            "2026-08-03",
            "removal-1",
            "Disposal",
            "SKU-A",
            "1.00",
            "USD",
        )
        document = ("\t".join(header) + "\n" + "\t".join(truncated_row) + "\n").encode()

        with self.assertRaisesRegex(
            ValueError,
            "line 2 has fewer values than header columns",
        ):
            parse_removal_fee_document(
                document,
                amazon_scope="NA",
            )

    def test_rejects_missing_contract_column_and_fractional_quantity(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing required columns"):
            normalize_parsed_removal_fee_document(
                parse_removal_fee_document(
                    b"sku\tremoval-fee\nSKU-A\t1\n",
                    amazon_scope="NA",
                ),
                marketplace_id="X",
            )

        fractional = _document(
            (
                "2026-08-03",
                "removal-1",
                "Disposal",
                "Standard",
                "Completed",
                "2026-08-03",
                "SKU-A",
                "FNSKU-A",
                "Unsellable",
                "1",
                "0",
                "0.5",
                "0",
                "0",
                "1.00",
                "USD",
            )
        )
        with self.assertRaisesRegex(ValueError, "non-negative integer"):
            normalize_parsed_removal_fee_document(
                parse_removal_fee_document(fractional, amazon_scope="NA"),
                marketplace_id="ATVPDKIKX0DER",
            )

    def test_rejects_negative_source_fee(self) -> None:
        negative_fee = _document(
            (
                "2026-08-03",
                "removal-1",
                "Disposal",
                "Standard",
                "Completed",
                "2026-08-03",
                "SKU-A",
                "FNSKU-A",
                "Unsellable",
                "1",
                "0",
                "1",
                "0",
                "0",
                "-0.01",
                "USD",
            )
        )

        with self.assertRaisesRegex(ValueError, "must not be negative"):
            normalize_parsed_removal_fee_document(
                parse_removal_fee_document(negative_fee, amazon_scope="NA"),
                marketplace_id="ATVPDKIKX0DER",
            )

    def test_rejects_unobserved_order_type_currency_and_date_forms(self) -> None:
        """Do not infer category or parse contracts that the live report did not show."""
        base_row = (
            "2026-08-03",
            "removal-1",
            "Return",
            "Standard",
            "Completed",
            "2026-08-03",
            "SKU-A",
            "FNSKU-A",
            "Sellable",
            "1",
            "0",
            "0",
            "1",
            "0",
            "1.00",
            "USD",
        )
        cases = (
            ("order-type", (*base_row[:2], "Recycle", *base_row[3:])),
            ("currency code", (*base_row[:-1], "US-DOLLAR")),
            ("unsupported date", ("2026-08-03garbage", *base_row[1:])),
        )

        for expected_error, row in cases:
            with (
                self.subTest(expected_error=expected_error),
                self.assertRaisesRegex(ValueError, expected_error),
            ):
                normalize_parsed_removal_fee_document(
                    parse_removal_fee_document(_document(row), amazon_scope="NA"),
                    marketplace_id="ATVPDKIKX0DER",
                )


if __name__ == "__main__":
    unittest.main()
