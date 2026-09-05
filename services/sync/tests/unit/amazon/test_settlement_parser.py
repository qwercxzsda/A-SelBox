"""Tests for lossless structural parsing of Settlement V2 report bytes."""

import hashlib
import unittest
from collections.abc import Iterator
from typing import cast
from unittest.mock import patch

from ....src.amazon import settlement_parser
from ....src.amazon.settlement_parser import parse_settlement_report
from ....src.amazon.settlement_tabular import SETTLEMENT_V2_COLUMNS
from ...support.settlement_reports import make_report_bytes, make_report_text


def _report_lines() -> list[str]:
    return make_report_text().splitlines()


class TestSettlementReportParser(unittest.TestCase):
    def test_preserves_header_metadata_and_content_rows_in_source_order(self) -> None:
        report_content = make_report_bytes()
        source_lines = make_report_text().splitlines()

        parsed_report = parse_settlement_report(report_content)

        self.assertEqual(parsed_report.tsv_columns, tuple(source_lines[0].split("\t")))
        self.assertEqual(parsed_report.metadata_source_line_number, 2)
        self.assertEqual(parsed_report.metadata_values, tuple(source_lines[1].split("\t")))
        self.assertEqual(parsed_report.content_row_count, 2)
        self.assertEqual(
            tuple(row.source_line_number for row in parsed_report.content_rows),
            (3, 4),
        )
        self.assertEqual(
            parsed_report.content_rows[0].column_values,
            tuple(source_lines[2].split("\t")),
        )
        self.assertEqual(
            parsed_report.decoded_content_sha256,
            hashlib.sha256(report_content, usedforsecurity=False).hexdigest(),
        )

    def test_accepts_invalid_business_tokens_and_preserves_whitespace_and_blanks(self) -> None:
        lines = _report_lines()
        columns = lines[0].split("\t")
        metadata = lines[1].split("\t")
        first_content = lines[2].split("\t")
        second_content = lines[3].split("\t")
        settlement_id = " 26169742111 "
        metadata[columns.index("settlement-id")] = settlement_id
        metadata[columns.index("settlement-start-date")] = " not-a-date "
        metadata[columns.index("settlement-end-date")] = "also-not-a-date"
        metadata[columns.index("total-amount")] = " not-a-number "
        metadata[columns.index("currency")] = " ?? "
        first_content[columns.index("settlement-id")] = settlement_id
        first_content[columns.index("order-id")] = "  "
        first_content[columns.index("amount")] = " invalid-amount "
        first_content[columns.index("posted-date")] = "invalid-date"
        second_content[columns.index("settlement-id")] = settlement_id
        lines[1:] = [
            "\t".join(metadata),
            "\t".join(first_content),
            "\t".join(second_content),
        ]

        parsed_report = parse_settlement_report(("\n".join(lines) + "\n").encode())

        self.assertEqual(
            parsed_report.metadata_values[columns.index("settlement-id")],
            settlement_id,
        )
        self.assertEqual(
            parsed_report.metadata_values[columns.index("settlement-start-date")],
            " not-a-date ",
        )
        self.assertEqual(
            parsed_report.metadata_values[columns.index("total-amount")],
            " not-a-number ",
        )
        self.assertEqual(
            parsed_report.content_rows[0].column_values[columns.index("order-id")],
            "  ",
        )
        self.assertEqual(
            parsed_report.content_rows[0].column_values[columns.index("amount")],
            " invalid-amount ",
        )
        self.assertEqual(
            parsed_report.content_rows[0].column_values[columns.index("promotion-id")],
            "",
        )

    def test_preserves_quote_characters_instead_of_applying_csv_conversion(self) -> None:
        lines = _report_lines()
        columns = lines[0].split("\t")
        content = lines[2].split("\t")
        content[columns.index("sku")] = '"quoted-sku"'
        lines[2] = "\t".join(content)

        parsed_report = parse_settlement_report(("\n".join(lines) + "\n").encode())

        self.assertEqual(
            parsed_report.content_rows[0].column_values[columns.index("sku")],
            '"quoted-sku"',
        )

    def test_accepts_the_live_singapore_six_line_preamble(self) -> None:
        preamble = "\n".join(
            (
                "preamble one",
                "preamble two",
                "preamble three",
                "preamble four",
                "preamble five",
                "\t",
            )
        )

        parsed_report = parse_settlement_report((preamble + "\n" + make_report_text()).encode())

        self.assertEqual(parsed_report.metadata_source_line_number, 8)
        self.assertEqual(parsed_report.content_rows[0].source_line_number, 9)

    def test_rejects_an_unobserved_preamble_shape(self) -> None:
        report_content = ("unobserved preamble\n" + make_report_text()).encode()

        with self.assertRaisesRegex(ValueError, "unsupported preamble"):
            parse_settlement_report(report_content)

    def test_rejects_transaction_values_in_the_metadata_row(self) -> None:
        lines = _report_lines()
        columns = lines[0].split("\t")
        metadata = lines[1].split("\t")
        metadata[columns.index("transaction-type")] = "Order"
        lines[1] = "\t".join(metadata)

        with self.assertRaisesRegex(
            ValueError,
            "metadata row must leave column transaction-type blank",
        ):
            parse_settlement_report(("\n".join(lines) + "\n").encode())

    def test_rejects_metadata_values_in_a_content_row(self) -> None:
        lines = _report_lines()
        columns = lines[0].split("\t")
        content = lines[2].split("\t")
        content[columns.index("currency")] = "CAD"
        lines[2] = "\t".join(content)

        with self.assertRaisesRegex(
            ValueError,
            "transaction row must leave column currency blank",
        ):
            parse_settlement_report(("\n".join(lines) + "\n").encode())

    def test_content_rows_require_the_exact_metadata_settlement_id(self) -> None:
        for transaction_settlement_id, message in (
            ("", "Missing required column settlement-id"),
            ("different-settlement", "has a different settlement-id"),
            (" 26169742111 ", "has a different settlement-id"),
        ):
            with self.subTest(transaction_settlement_id=transaction_settlement_id):
                lines = _report_lines()
                columns = lines[0].split("\t")
                content = lines[2].split("\t")
                content[columns.index("settlement-id")] = transaction_settlement_id
                lines[2] = "\t".join(content)

                with self.assertRaisesRegex(ValueError, message):
                    parse_settlement_report(("\n".join(lines) + "\n").encode())

    def test_validates_metadata_before_requesting_later_rows(self) -> None:
        def rows() -> Iterator[tuple[int, tuple[str, ...]]]:
            yield 2, ("",) * len(SETTLEMENT_V2_COLUMNS)
            raise AssertionError("Parser requested a later row before validating metadata.")

        with (
            patch.object(
                settlement_parser,
                "iter_settlement_tsv_rows",
                return_value=rows(),
            ),
            self.assertRaisesRegex(ValueError, "Missing required column settlement-id"),
        ):
            parse_settlement_report(make_report_bytes())

    def test_rejects_duplicate_headers_and_nonmatching_row_widths(self) -> None:
        valid_lines = _report_lines()
        malformed_reports = (
            "\n".join(
                [
                    valid_lines[0] + "\tamount",
                    *(line + "\t" for line in valid_lines[1:]),
                ]
            )
            + "\n",
            "\n".join([valid_lines[0], valid_lines[1], valid_lines[2] + "\textra"]) + "\n",
            "\n".join([valid_lines[0], valid_lines[1], "\t".join(valid_lines[2].split("\t")[:-1])])
            + "\n",
        )

        for index, report_text in enumerate(malformed_reports):
            with (
                self.subTest(index=index),
                self.assertRaisesRegex(
                    ValueError,
                    "duplicate header|more values|fewer values",
                ),
            ):
                parse_settlement_report(report_text.encode())

    def test_rejects_missing_supported_header_column(self) -> None:
        lines = _report_lines()
        columns = lines[0].split("\t")
        removed_index = columns.index("promotion-id")
        lines[0] = "\t".join(columns[:removed_index] + columns[removed_index + 1 :])
        for line_index in range(1, len(lines)):
            values = lines[line_index].split("\t")
            lines[line_index] = "\t".join(values[:removed_index] + values[removed_index + 1 :])

        with self.assertRaisesRegex(ValueError, "promotion-id"):
            parse_settlement_report(("\n".join(lines) + "\n").encode())

    def test_rejects_mutable_or_decoded_report_content(self) -> None:
        invalid_content = (
            cast(bytes, bytearray(make_report_bytes())),
            cast(bytes, make_report_text()),
        )

        for report_content in invalid_content:
            with (
                self.subTest(content_type=type(report_content).__name__),
                self.assertRaisesRegex(TypeError, "report_content must be bytes"),
            ):
                parse_settlement_report(report_content)


if __name__ == "__main__":
    unittest.main()
