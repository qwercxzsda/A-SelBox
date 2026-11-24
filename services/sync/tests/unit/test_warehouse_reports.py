"""Account-wide report duplicates, version stability and source-only attribution keys."""

import unittest
from datetime import UTC, date, datetime
from decimal import Decimal

from services.sync.src.reference.reports import prepare_report
from services.sync.src.reference.run import report_requests
from services.sync.src.reference.taxes import finance_rate
from services.sync.tests.support.currencies import CURRENCY_DECIMALS
from services.sync.tests.support.fakes import FakeDatabaseConnection

END = date(2026, 9, 1)
MONTH = date(2026, 8, 1)
REMOVAL = (
    "request-date\tlast-updated-date\torder-id\torder-type\t"
    "order-status\tsku\tfnsku\tremoval-fee\tcurrency\n"
)
ORDER = (
    "2026-09-01T01:30:00+03:00\t2026-09-03T00:00:00+00:00\t"
    "order\tReturn\tCompleted\told-sku\tX012345678\t11\tJPY\n"
)
LEDGER = "Date\tFNSKU\tASIN\tMSKU\tTitle\tLocation\tDisposition\tReceipts\n"
LEDGER_ROW = "08/2026\tX012345678\tB012345678\tSKU\told title\tJP\tSELLABLE\t1\n"


class WarehouseReportTests(unittest.TestCase):
    def test_removal_identical_lines_count_and_offset_changes_preserve_the_version(self) -> None:
        def parse(rows: str) -> list[dict[str, object]]:
            return prepare_report(
                "REMOVAL_ORDER", (REMOVAL + rows).encode(), "JAPAN", MONTH, END, CURRENCY_DECIMALS
            )["order"]

        rows = parse(ORDER + ORDER)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], rows[1])
        self.assertEqual(rows[0]["base_amount"], Decimal(10))
        self.assertEqual(rows[0]["tax_amount"], Decimal(1))
        self.assertEqual(rows[0]["ledger_first_month"], "2026-08-01")
        self.assertEqual(rows[0]["ledger_last_month"], "2026-09-01")
        self.assertEqual(
            rows,
            parse((ORDER + ORDER).replace("2026-09-01T01:30:00+03:00", "2026-08-31T22:30:00Z")),
        )
        self.assertNotIn("sku", rows[0])

    def test_ledger_preserves_country_rows_and_excludes_title(self) -> None:
        def parse(rows: str) -> list[dict[str, object]]:
            return prepare_report(
                "INVENTORY_LEDGER", (LEDGER + rows).encode(), "JAPAN", MONTH, END, CURRENCY_DECIMALS
            )["2026-08"]

        self.assertEqual(parse(LEDGER_ROW), parse(LEDGER_ROW.replace("old title", "new title")))
        self.assertEqual(len(parse(LEDGER_ROW + LEDGER_ROW)), 2)
        with self.assertRaises(ValueError):
            parse(LEDGER_ROW.replace("08/2026", "09/2026"))
        with self.assertRaises(ValueError):
            parse(LEDGER_ROW.replace("\tSKU\t", "\tB098765432\t"))
        self.assertEqual(
            prepare_report(
                "INVENTORY_LEDGER", b"", "JAPAN", MONTH, END, CURRENCY_DECIMALS, cancelled=True
            ),
            {"2026-08": []},
        )
        with self.assertRaises(ValueError):
            prepare_report("INVENTORY_LEDGER", b"", "JAPAN", MONTH, END, CURRENCY_DECIMALS)

    def test_unknown_tax_pair_rejects_whole_report_including_valid_prior_rows(self) -> None:
        with self.assertRaises(ValueError):
            prepare_report(
                "REMOVAL_ORDER",
                (REMOVAL + ORDER + ORDER.replace("JPY", "GBP")).encode(),
                "JAPAN",
                MONTH,
                END,
                CURRENCY_DECIMALS,
            )
        self.assertEqual(finance_rate("Amazon.ca", "DISPOSAL_FEES", True), Decimal("0.07"))
        with self.assertRaises(ValueError):
            finance_rate("Amazon.com.mx", "STORAGE_FEES")

    def test_each_account_report_uses_one_request_and_its_own_calendar_period(self) -> None:
        for loaded, ledger_start in [(False, date(2025, 4, 1)), (True, date(2026, 8, 1))]:
            db = FakeDatabaseConnection(fetchone_results=[(loaded,)])
            requests = list(report_requests(db, "seller", "NA", None, None, date(2026, 11, 24)))
            periods = {r.source: (r.start_date, r.end_date) for r in requests}
            self.assertEqual(len(requests), 4)
            self.assertEqual(
                periods,
                {
                    "INVENTORY_LEDGER": (ledger_start, date(2026, 11, 1)),
                    "STORAGE": (date(2026, 8, 1), date(2026, 11, 1)),
                    "AGED_STORAGE": (date(2026, 8, 1), date(2026, 11, 1)),
                    "REMOVAL_ORDER": (date(2025, 11, 24), date(2026, 11, 25)),
                },
            )

    def test_zero_row_answer_loads_every_finished_month(self) -> None:
        groups = prepare_report(
            "AGED_STORAGE",
            b"",
            "NA",
            date(2026, 7, 1),
            date(2026, 10, 1),
            CURRENCY_DECIMALS,
            cancelled=True,
        )
        self.assertEqual(groups, {"2026-07": [], "2026-08": [], "2026-09": []})

    def test_same_day_removals_are_bounded_by_the_capture_instant(self) -> None:
        start = datetime(2026, 8, 31, 22, 30, tzinfo=UTC)
        with self.assertRaisesRegex(ValueError, "outside the requested period"):
            prepare_report(
                "REMOVAL_ORDER",
                (REMOVAL + ORDER).encode(),
                "JAPAN",
                MONTH,
                END,
                CURRENCY_DECIMALS,
                captured_at=start,
            )
