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
    "request-date\tlast-updated-date\torder-id\torder-type\torder-status\tsku\tfnsku\t"
    "disposed-quantity\tshipped-quantity\tremoval-fee\tcurrency\n"
)
# A Return fills shipped-quantity and leaves disposed-quantity blank.
ORDER = (
    "2026-09-01T01:30:00+03:00\t2026-09-03T00:00:00+00:00\t"
    "order\tReturn\tCompleted\told-sku\tX012345678\t\t2\t11\tJPY\n"
)
LEDGER = "Date\tFNSKU\tASIN\tMSKU\tTitle\tLocation\tDisposition\tReceipts\n"
LEDGER_ROW = "08/2026\tX012345678\tB012345678\tSKU\told title\tJP\tSELLABLE\t1\n"
STORAGE_BASIS = (
    "average_quantity_on_hand",
    "product_size_tier",
    "estimated_total_item_volume",
    "volume_units",
)


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

    def test_removal_orders_state_the_quantity_of_their_order_type(self) -> None:
        def parse(order_type: str, disposed: str, shipped: str) -> dict[str, object]:
            order = ORDER.replace("\tReturn\t", f"\t{order_type}\t").replace(
                "\t\t2\t11\t", f"\t{disposed}\t{shipped}\t11\t"
            )
            return prepare_report(
                "REMOVAL_ORDER", (REMOVAL + order).encode(), "JAPAN", MONTH, END, CURRENCY_DECIMALS
            )["order"][0]

        # Amazon fills disposed-quantity for a Disposal, shipped-quantity for the other two.
        for order_type, disposed, shipped in (
            ("Disposal", "3", ""),
            ("Return", "", "3"),
            ("Liquidations", "", "0"),
        ):
            with self.subTest(order_type=order_type):
                row = parse(order_type, disposed, shipped)
                self.assertEqual(
                    (row["disposed_quantity"], row["shipped_quantity"]),
                    (disposed or None, shipped or None),
                )
        for order_type, disposed, shipped in (
            ("Disposal", "", "3"),
            ("Disposal", "3", "3"),
            ("Return", "3", ""),
            ("Liquidations", "", ""),
            ("Liquidations", "1", "1"),
        ):
            with (
                self.subTest(order_type=order_type, disposed=disposed, shipped=shipped),
                self.assertRaisesRegex(ValueError, "do not match the order type"),
            ):
                parse(order_type, disposed, shipped)

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

    def test_tiered_aged_storage_sums_both_amounts_and_keeps_each_product_row(self) -> None:
        short = "short-time-range-long-term-storage-fee"
        long = "long-time-range-long-term-storage-fee"
        headers = [
            "snapshot-date",
            "sku",
            "fnsku",
            "asin",
            "currency",
            "country",
            short,
            "qty-charged-" + short,
            long,
            "qty-charged-" + long,
        ]
        values = [
            "2026-08-14T00:00:00Z",
            "SKU",
            "X012345678",
            "B012345678",
            "SGD",
            "SG",
            "0.10",
            "1",
            "5.40",
            "54",
        ]

        def parse(columns: list[str], data: list[str]) -> list[dict[str, object]]:
            content = "\n".join(("\t".join(columns), "\t".join(data), "\t".join(data)))
            return prepare_report(
                "AGED_STORAGE", content.encode(), "SINGAPORE", MONTH, END, CURRENCY_DECIMALS
            )["2026-08"]

        first, second = parse(headers, values)
        self.assertEqual(first, second)
        self.assertEqual(first["fee_amount"], Decimal("5.50"))
        self.assertEqual(first["base_amount"], Decimal("5.50"))
        self.assertEqual(first["tax_amount"], Decimal("0.50"))
        self.assertEqual(first["quantity_charged"], "55")
        self.assertEqual(first["sku_printed"], "SKU")
        with self.assertRaisesRegex(ValueError, "incomplete or ambiguous"):
            parse(headers[:-1], values[:-1])
        with self.assertRaisesRegex(ValueError, "incomplete or ambiguous"):
            parse([*headers, "amount-charged"], [*values, "5.50"])
        with self.assertRaisesRegex(ValueError, "finite"):
            parse(headers, [*values[:-2], "NaN", "54"])

    def test_storage_keeps_amazon_quantity_volume_and_either_rate_form(self) -> None:
        # Australia and Singapore print one storage rate; Europe, Japan and North America
        # print a base rate and a utilization surcharge rate.
        one_rate = {"storage_rate": "13.2"}
        utilization = {
            "storage_utilization_ratio": "9.2",
            "storage_utilization_ratio_units": "weeks",
        }
        rate_pair = {"base_rate": "0.78", "utilization_surcharge_rate": "0.0"}
        two_rates = utilization | rate_pair
        # Amazon's split of the 0.01 fee, each part rounded on its own.
        split = {"est_vol_for_sus": "7.0E-4", "est_base_msf": "0.0062", "est_sus": "0.0039"}

        def parse(
            rates: dict[str, str], *, omit: str | None = None, **changes: str
        ) -> dict[str, object]:
            row = {
                "asin": "B012345678",
                "fnsku": "X012345678",
                "fulfillment_center": "'SIN8'",
                "country_code": "SG",
                "volume_units": "cubic meters",
                "product_size_tier": "Standard-Size",
                "average_quantity_on_hand": "61.97",
                "estimated_total_item_volume": "8.0E-4",
                "month_of_charge": "2026-08",
                **rates,
                "est_vol_for_sus": "0.0",
                "est_base_msf": "0.0",
                "est_sus": "0.0",
                "currency": "SGD",
                "estimated_monthly_storage_fee": "0.01",
            } | changes
            row.pop(omit or "", None)
            content = "\t".join(row) + "\n" + "\t".join(row.values()) + "\n"
            report = prepare_report(
                "STORAGE", content.encode(), "SINGAPORE", MONTH, END, CURRENCY_DECIMALS
            )
            return report["2026-08"][0]

        row = parse(one_rate)
        self.assertEqual(
            {key: row[key] for key in (*STORAGE_BASIS, "storage_rate")},
            {
                "average_quantity_on_hand": Decimal("61.97"),
                "product_size_tier": "Standard-Size",
                "estimated_total_item_volume": Decimal("0.00080"),
                "volume_units": "cubic meters",
                "storage_rate": Decimal("13.2"),
            },
        )
        self.assertNotIn("base_rate", row)
        # A one-rate report prints a zero split, which is not kept.
        self.assertFalse({"storage_utilization_ratio", *split}.intersection(row))
        row = parse(two_rates, volume_units="cubic feet", **split)
        self.assertEqual(
            (row["base_rate"], row["utilization_surcharge_rate"], row["volume_units"]),
            (Decimal("0.78"), Decimal(0), "cubic feet"),
        )
        self.assertNotIn("storage_rate", row)
        self.assertEqual(
            {key: row[key] for key in ("storage_utilization_ratio", *split)},
            {
                "storage_utilization_ratio": "9.2",
                "est_vol_for_sus": Decimal("0.00070"),
                "est_base_msf": Decimal("0.0062"),
                "est_sus": Decimal("0.0039"),
            },
        )
        self.assertEqual(
            parse(two_rates | {"storage_utilization_ratio": ">52"}, **split)[
                "storage_utilization_ratio"
            ],
            ">52",
        )
        for rates in ({}, one_rate | two_rates, {"base_rate": "0.78"}):
            with self.subTest(rates=rates), self.assertRaisesRegex(ValueError, "rate columns"):
                parse(rates)
        for rates in (
            one_rate | utilization,
            rate_pair,
            rate_pair | {"storage_utilization_ratio": "9"},
        ):
            with (
                self.subTest(rates=rates),
                self.assertRaisesRegex(ValueError, "utilization columns"),
            ):
                parse(rates, **split)
        for change, message in (
            ({"storage_utilization_ratio": "52+"}, "utilization ratio"),
            ({"storage_utilization_ratio": ""}, "utilization ratio"),
            ({"storage_utilization_ratio_units": "days"}, "utilization ratio"),
            ({"est_base_msf": "0.0059"}, "do not add up"),
            ({"est_sus": "-0.0039"}, "non-negative"),
            ({"estimated_monthly_storage_fee": "NaN"}, "currency or amount"),
        ):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, message):
                parse(two_rates, **(split | change))
        with self.assertRaisesRegex(ValueError, "one-rate storage report"):
            parse(one_rate, est_sus="0.0039")
        with self.assertRaisesRegex(ValueError, "headers are missing"):
            parse(one_rate, omit="est_sus")
        for change in (
            {"volume_units": "cubic inches"},
            {"product_size_tier": " "},
            {"average_quantity_on_hand": "-1"},
            {"estimated_total_item_volume": "--"},
            {"storage_rate": "NaN"},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                parse(one_rate, **change)

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
