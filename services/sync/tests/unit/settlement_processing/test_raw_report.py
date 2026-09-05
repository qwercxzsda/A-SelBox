"""Tests for versioned conversion and fee policy in Workflow B."""

import unittest
from dataclasses import replace
from uuid import uuid4

from ....src.numeric import Numeric
from ....src.settlement_processing.ledger_entry_builder import UnrecognizedMarketplaceError
from ....src.settlement_processing.raw_report import prepare_settlement_report
from ....src.settlement_processing.requirements import derive_auxiliary_requirements
from ...support.settlement_processing import stored_settlement_report


class TestRawSettlementProcessing(unittest.TestCase):
    def test_conversion_happens_during_processing_and_reconciles_report(self) -> None:
        prepared = prepare_settlement_report(
            stored_settlement_report(),
            id_factory=lambda: str(uuid4()),
        )

        self.assertEqual(prepared.header.total_amount, Numeric("8.00"))
        self.assertEqual(
            tuple(entry.settlement_amount for entry in prepared.ledger_entries),
            (Numeric("10.00"), Numeric("-2.00")),
        )
        self.assertEqual(
            {entry.marketplace_id for entry in prepared.ledger_entries},
            {"ATVPDKIKX0DER"},
        )

    def test_report_total_mismatch_is_rejected_only_during_processing(self) -> None:
        report = stored_settlement_report()
        bad_metadata = tuple(
            "9.00" if column == "total-amount" else value
            for column, value in zip(report.columns, report.metadata_values, strict=True)
        )

        with self.assertRaisesRegex(ValueError, "reconcile"):
            prepare_settlement_report(
                replace(report, metadata_values=bad_metadata),
                id_factory=lambda: str(uuid4()),
            )

    def test_used_ambiguous_or_unaligned_marketplace_names_are_rejected(self) -> None:
        report = stored_settlement_report()
        for names, message in (
            (("Amazon.com", "Amazon.com"), "Overlapping marketplace mappings"),
            (("Amazon.com",), "do not align"),
        ):
            with self.subTest(names=names), self.assertRaisesRegex(ValueError, message):
                prepare_settlement_report(
                    replace(
                        report,
                        marketplace_ids=("ATVPDKIKX0DER", "A2EUQ1WTGCTBG2"),
                        marketplace_names=names,
                    ),
                    id_factory=lambda: str(uuid4()),
                )

    def test_unused_duplicate_marketplace_names_do_not_block_processing(self) -> None:
        report = replace(
            stored_settlement_report(),
            marketplace_ids=("ATVPDKIKX0DER", "A2EUQ1WTGCTBG2", "A1AM78C64UM0Y8"),
            marketplace_names=("Amazon.com", "Other name", "Other name"),
        )

        prepared = prepare_settlement_report(report, id_factory=lambda: str(uuid4()))

        self.assertEqual(
            tuple(entry.marketplace_id for entry in prepared.ledger_entries),
            ("ATVPDKIKX0DER", "ATVPDKIKX0DER"),
        )

    def test_unrecognized_marketplace_aborts_single_and_multiple_marketplace_reports(self) -> None:
        report = stored_settlement_report()
        unknown_row = report.rows[-1]
        unknown_row = replace(
            unknown_row,
            values=tuple(
                "Unknown Marketplace" if column == "marketplace-name" else value
                for column, value in zip(report.columns, unknown_row.values, strict=True)
            ),
        )
        for marketplace_count in (1, 2):
            with (
                self.subTest(marketplace_count=marketplace_count),
                self.assertRaises(UnrecognizedMarketplaceError) as raised,
            ):
                prepare_settlement_report(
                    replace(
                        report,
                        marketplace_ids=("ATVPDKIKX0DER", "A2EUQ1WTGCTBG2")[:marketplace_count],
                        marketplace_names=("Amazon.com", "Amazon.ca")[:marketplace_count],
                        rows=(*report.rows[:-1], unknown_row),
                    ),
                    id_factory=lambda: str(uuid4()),
                )

            self.assertEqual(raised.exception.source_line_number, unknown_row.source_line_number)
            self.assertRegex(str(raised.exception), r"row 4 .*unrecognized marketplace-name")

    def test_blank_marketplace_names_fall_back_only_for_single_marketplace_reports(self) -> None:
        report = stored_settlement_report()
        for blank_name in ("", " \t "):
            rows = tuple(
                replace(
                    row,
                    values=tuple(
                        blank_name if column == "marketplace-name" else value
                        for column, value in zip(report.columns, row.values, strict=True)
                    ),
                )
                for row in report.rows
            )
            for marketplace_count in (1, 2):
                with self.subTest(blank_name=blank_name, marketplace_count=marketplace_count):
                    prepared = prepare_settlement_report(
                        replace(
                            report,
                            marketplace_ids=("ATVPDKIKX0DER", "A2EUQ1WTGCTBG2")[:marketplace_count],
                            marketplace_names=("Amazon.com", "Amazon.ca")[:marketplace_count],
                            rows=rows,
                        ),
                        id_factory=lambda: str(uuid4()),
                    )

                    expected_marketplace_id = "ATVPDKIKX0DER" if marketplace_count == 1 else None
                    self.assertEqual(
                        tuple(entry.marketplace_id for entry in prepared.ledger_entries),
                        (expected_marketplace_id, expected_marketplace_id),
                    )
                    self.assertTrue(
                        all(entry.marketplace_name is None for entry in prepared.ledger_entries)
                    )

    def test_direct_sales_report_requires_no_auxiliary_source(self) -> None:
        prepared = prepare_settlement_report(
            stored_settlement_report(),
            id_factory=lambda: str(uuid4()),
        )

        self.assertFalse(derive_auxiliary_requirements(prepared.ledger_entries).any)


if __name__ == "__main__":
    unittest.main()
