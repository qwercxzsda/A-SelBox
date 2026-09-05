import csv
import hashlib
import unittest

from ....src.amazon.fba_reports.parsing import parse_fba_tsv_document
from ....src.amazon.fba_reports.report_types import (
    FBA_AGED_STORAGE_FEE_REPORT,
    FBA_REMOVAL_ORDER_DETAIL_REPORT,
)
from ....src.amazon.fba_reports.tabular import iter_normalized_parsed_tsv_rows

_REPORT_TYPES = (
    FBA_AGED_STORAGE_FEE_REPORT,
    FBA_REMOVAL_ORDER_DETAIL_REPORT,
)


def _rows(
    document: bytes,
    *,
    amazon_scope: str,
    report_type: str,
) -> tuple[tuple[int, dict[str, str]], ...]:
    parsed_document = parse_fba_tsv_document(
        document,
        amazon_scope=amazon_scope,
        report_type=report_type,
        report_name="FBA test report",
    )
    return tuple(
        iter_normalized_parsed_tsv_rows(
            parsed_document,
            report_name="FBA test report",
            required_columns={"sku", "label"},
        )
    )


class TestFbaTabularDocumentEncoding(unittest.TestCase):
    def test_accepts_utf8_baseline_for_each_supported_scope_and_report_type(self) -> None:
        """Exercise configured behavior without labelling every pair live-observed."""
        cases = tuple(
            (scope, report_type)
            for scope in ("NA", "EU", "JAPAN", "SINGAPORE", "AUSTRALIA")
            for report_type in _REPORT_TYPES
            if (scope, report_type) != ("JAPAN", FBA_AGED_STORAGE_FEE_REPORT)
        )

        for amazon_scope, report_type in cases:
            with self.subTest(amazon_scope=amazon_scope, report_type=report_type):
                document = "sku\tlabel\n商品-SKU\t日本語\n".encode()

                self.assertEqual(
                    _rows(
                        document,
                        amazon_scope=amazon_scope,
                        report_type=report_type,
                    ),
                    ((2, {"sku": "商品-SKU", "label": "日本語"}),),
                )

    def test_uses_live_confirmed_cp932_for_japan_aged_storage(self) -> None:
        document = "sku\tlabel\n商品-SKU\t日本語\n".encode("cp932")

        self.assertEqual(
            _rows(
                document,
                amazon_scope="JAPAN",
                report_type=FBA_AGED_STORAGE_FEE_REPORT,
            ),
            ((2, {"sku": "商品-SKU", "label": "日本語"}),),
        )

    def test_never_falls_back_to_another_decoder(self) -> None:
        cases = (
            ("JAPAN", FBA_AGED_STORAGE_FEE_REPORT, "utf-8", "cp932"),
            ("NA", FBA_AGED_STORAGE_FEE_REPORT, "cp932", "utf-8-sig"),
            ("EU", FBA_REMOVAL_ORDER_DETAIL_REPORT, "cp932", "utf-8-sig"),
            ("SINGAPORE", FBA_REMOVAL_ORDER_DETAIL_REPORT, "cp932", "utf-8-sig"),
        )

        for amazon_scope, report_type, encoding, required_encoding in cases:
            with (
                self.subTest(amazon_scope=amazon_scope, report_type=report_type),
                self.assertRaisesRegex(ValueError, f"not valid {required_encoding}"),
            ):
                _rows(
                    "sku\tlabel\n商品-SKU\t日本語\n".encode(encoding),
                    amazon_scope=amazon_scope,
                    report_type=report_type,
                )

    def test_rejects_a_scope_or_report_type_without_an_encoding_policy(self) -> None:
        for amazon_scope, report_type in (
            ("UNCONFIRMED_SCOPE", FBA_AGED_STORAGE_FEE_REPORT),
            ("NA", "UNCONFIRMED_REPORT_TYPE"),
        ):
            with (
                self.subTest(amazon_scope=amazon_scope, report_type=report_type),
                self.assertRaisesRegex(ValueError, "no configured document encoding"),
            ):
                _rows(
                    b"sku\tlabel\nSKU-A\tProduct A\n",
                    amazon_scope=amazon_scope,
                    report_type=report_type,
                )

    def test_decode_error_does_not_retain_private_report_bytes(self) -> None:
        private_document = b"sku\tlabel\nPRIVATE-SKU\t\xff\n"

        with self.assertRaises(ValueError) as raised:
            _rows(
                private_document,
                amazon_scope="NA",
                report_type=FBA_AGED_STORAGE_FEE_REPORT,
            )

        self.assertIsNone(raised.exception.__context__)


class TestFbaTabularRowShape(unittest.TestCase):
    def test_multiline_quoted_cells_retain_physical_source_line_numbers(self) -> None:
        for newline in ("\n", "\r\n", "\r"):
            with self.subTest(newline=repr(newline)):
                document = (
                    f'sku\tlabel{newline}SKU-A\t"Product{newline}A"{newline}'
                    f"SKU-B\tProduct B{newline}"
                ).encode()
                self.assertEqual(
                    _rows(
                        document,
                        amazon_scope="NA",
                        report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                    ),
                    (
                        (2, {"sku": "SKU-A", "label": f"Product{newline}A"}),
                        (4, {"sku": "SKU-B", "label": "Product B"}),
                    ),
                )

    def test_rejects_malformed_quoted_cells_without_accepting_truncated_content(self) -> None:
        for row in (b'SKU-A\t"unterminated\n', b'SKU-A\t"label"trailing\n'):
            with self.subTest(row=row), self.assertRaises(csv.Error):
                _rows(
                    b"sku\tlabel\n" + row,
                    amazon_scope="NA",
                    report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                )

    def test_width_errors_after_multiline_cells_report_the_physical_line(self) -> None:
        with self.assertRaisesRegex(ValueError, "line 4 has fewer values"):
            _rows(
                b'sku\tlabel\nSKU-A\t"Product\nA"\nSKU-B\n',
                amazon_scope="NA",
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            )

    def test_simple_parser_preserves_generic_values_without_business_validation(self) -> None:
        document = (
            b"order-type\tcurrency\tremoval-fee\trequest-date\n"
            b" Recycle \tUS-DOLLAR\t-0.01\tnot-a-date\n"
        )

        parsed = parse_fba_tsv_document(
            document,
            amazon_scope="NA",
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            report_name="FBA test report",
        )

        self.assertEqual(
            parsed.header,
            ("order-type", "currency", "removal-fee", "request-date"),
        )
        self.assertEqual(parsed.content_sha256, hashlib.sha256(document).hexdigest())
        self.assertEqual(parsed.rows[0].source_line_number, 2)
        self.assertEqual(
            parsed.rows[0].values,
            (" Recycle ", "US-DOLLAR", "-0.01", "not-a-date"),
        )

    def test_rejects_a_row_with_fewer_values_than_the_header(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "line 2 has fewer values than header columns",
        ):
            _rows(
                b"sku\tlabel\nSKU-A\n",
                amazon_scope="NA",
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            )

    def test_rejects_a_row_with_more_values_than_the_header(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "line 2 has more values than header columns",
        ):
            _rows(
                b"sku\tlabel\nSKU-A\tProduct A\textra\n",
                amazon_scope="NA",
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            )

    def test_preserves_a_present_but_blank_trailing_value(self) -> None:
        self.assertEqual(
            _rows(
                b"sku\tlabel\nSKU-A\t\n",
                amazon_scope="NA",
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            ),
            ((2, {"sku": "SKU-A", "label": ""}),),
        )


if __name__ == "__main__":
    unittest.main()
