"""Financial review months and outcome pages reconcile exactly and stay administrator-only."""

from datetime import date
from decimal import Decimal
from typing import LiteralString, cast

import psycopg

from services.db.supabase.tests.reference_fixture import ReferenceFixture

_MONTHS: LiteralString = "select * from public.financial_review_months(%s,%s)"
_PAGE: LiteralString = "select * from public.financial_outcome_page(%s,%s,%s,%s,%s,%s,%s)"
# Outcomes grouped like the months RPC. Reasons belong to differences, groups to SelBox types.
_GROUPED_OUTCOMES: LiteralString = """
    select date_trunc('month',posted_date)::date,currency,outcome,
        case when outcome='DIFFERENCE' then reason end,
        case when outcome='SELBOX' then selbox_group end,
        sum(base_amount),sum(tax_amount),count(*)
    from public.financial_outcomes
    where marketplace_name=%s and extract(year from posted_date)=%s
    group by 1,2,3,4,5"""
_NATIVE_FINANCES: LiteralString = """
    select date_trunc('month',posted_date)::date,currency,'FINANCES',null,null,
        coalesce(sum(amount) filter (where amount_part<>'TAX'),0),
        coalesce(sum(amount) filter (where amount_part='TAX'),0),count(*)
    from private.finances_component_details
    where is_current and activity_eligible and marketplace_name=%s
        and extract(year from posted_date)=%s
    group by 1,2"""
# Finances minus Company, SelBox and Difference for each month, for base and tax.
_IMBALANCES: LiteralString = """
    select month,currency,
        sum(case when measure='FINANCES' then base_amount else -base_amount end),
        sum(case when measure='FINANCES' then tax_amount else -tax_amount end)
    from public.financial_review_months(%s,%s) group by 1,2"""

type Key = tuple[object, ...]


def _by_key(rows: list[tuple[object, ...]]) -> dict[Key, Key]:
    return {row[:5]: row[5:] for row in rows}


class FinancialReviewTests(ReferenceFixture):
    def setUp(self) -> None:
        super().setUp()
        self.administrator = self.account("administrator")

    def review_charges(self) -> None:
        """Every outcome, reason and group across two marketplaces, years and seller accounts."""
        self.assign_sku("A", self.company)
        self.assign_sku("B", self.other)
        self.reference(
            "INVENTORY_LEDGER",
            "2026-01",
            [
                {"month": "2026-01-01", "sku": "A", "fnsku": "X000000001", "asin": "B000000001"},
                {"month": "2026-01-01", "sku": "B", "fnsku": "X000000002", "asin": "B000000001"},
            ],
        )
        removal = {
            "currency": "USD",
            "base_amount": "3",
            "fee_amount": "3.3",
            "removal_order_id": "remove",
            "requested_at": "2026-01-01",
            "last_updated_at": "2026-01-10",
            "order_type": "Disposal",
            "order_status": "Completed",
            "disposed_quantity": "1",
            "tax_amount": "0.3",
            "fnsku": "X000000001",
            "ledger_first_month": "2026-01-01",
            "ledger_last_month": "2026-01-01",
        }
        self.reference("REMOVAL_ORDER", "remove", [removal, removal])
        storage = {
            "marketplace_name": "Amazon.com",
            "country_code": "US",
            "month_of_charge": "2026-01-01",
            "fnsku": "X000000001",
            "asin": "B000000001",
            "currency": "USD",
            "fee_amount": "1.005",
            "base_amount": "1.005",
            "tax_amount": "0",
            "ledger_first_month": "2026-01-01",
            "ledger_last_month": "2026-01-01",
        }
        self.reference("STORAGE", "2026-01", [storage])
        ledger = {"start": "2026-01-01", "end": "2026-01-01"}
        self.finance(
            [
                {"route": "SKU", "sku": "A", "amount": "3", "date": "2026-02-01"},
                {"route": "SKU", "sku": "A", "amount": "0.3", "part": "TAX", "date": "2026-02-01"},
                {"route": "SKU", "sku": "MISSING", "amount": "2", "date": "2026-01-31"},
                {"route": "SELBOX", "amount": "-2", "date": "2026-01-31"},
                {"route": "SELBOX", "group": "BALANCE_MOVEMENT", "amount": "-1"},
                {"route": "REMOVAL_ORDER", "key": "remove", "amount": "-2.2"},
                {"route": "REMOVAL_ORDER", "key": "remove", "amount": "-4.4", "date": "2026-02-15"},
                {"route": "ASIN", "asin": "B000000001", "amount": "-1", **ledger},
                {"route": "FNSKU", "fnsku": "X000000099", "amount": "-2", **ledger},
                {
                    "route": "FNSKU",
                    "fnsku": "X000000099",
                    "amount": "-3",
                    **ledger,
                    "start": "2025-12-01",
                },
                {"route": "SHIPMENT", "amount": "-4"},
                {"route": "SKU", "sku": "A", "amount": "7", "marketplace": "Amazon.ca"},
                {"route": "SKU", "sku": "A", "amount": "11", "date": "2025-12-31"},
                {"route": "SKU", "sku": "A", "amount": "13", "is_activity": False},
                # The storage report sums to 1.005: ROUNDING and TOTALS_DIFFER share one row ID.
                {"route": "STORAGE", "month": "2026-01-01", "amount": "-1.20"},
                {"route": "REMOVAL_ORDER", "key": "not-loaded", "amount": "-0.5"},
                {"route": "SELBOX", "group": "TAX_RECLASSIFICATION", "amount": "-0.25"},
                # One transaction: several amounts of one SKU, an unassigned SKU and an account fee.
                {
                    "date": "2026-01-20",
                    "amounts": [
                        {"route": "SKU", "sku": "A", "amount": "5"},
                        {"route": "SKU", "sku": "A", "amount": "0.5", "part": "TAX"},
                        {"route": "SKU", "sku": "A", "amount": "-1.5", "type": "FEE"},
                        {"route": "SKU", "sku": "MISSING", "amount": "1"},
                        {"route": "SELBOX", "amount": "-0.3"},
                    ],
                },
            ]
        )
        # A second seller account in the same marketplace adds to the same months.
        self.finance(
            [
                {"route": "SKU", "sku": "A", "amount": "4", "date": "2026-01-10"},
                {"route": "SKU", "sku": "MISSING", "amount": "0.75"},
                {"route": "SHIPMENT", "amount": "-0.4"},
            ],
            seller="second-seller",
        )

    def months(self, marketplace: str, year: int) -> list[tuple[object, ...]]:
        return self.as_user(self.administrator, _MONTHS, (marketplace, year))

    def page(
        self,
        outcome: str,
        month: date,
        reason: object = None,
        group: object = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> list[tuple[object, ...]]:
        return self.as_user(
            self.administrator, _PAGE, (outcome, month, "Amazon.com", reason, group, limit, offset)
        )

    def test_months_equal_grouped_outcomes_and_balance_finances(self) -> None:
        self.review_charges()
        for marketplace, year in (("Amazon.com", 2026), ("Amazon.com", 2025), ("Amazon.ca", 2026)):
            with self.subTest(marketplace=marketplace, year=year):
                months = self.months(marketplace, year)
                expected = (
                    self.as_user(self.administrator, _GROUPED_OUTCOMES, (marketplace, year))
                    + self.connection.execute(_NATIVE_FINANCES, (marketplace, year)).fetchall()
                )
                self.assertEqual(_by_key(months), _by_key(expected))
                self.assertEqual(len(months), len(expected))
                # Rows arrive in key order; within one measure reasons or groups are never null.
                self.assertEqual(
                    [row[:5] for row in months],
                    sorted((row[:5] for row in months), key=lambda key: tuple(map(str, key))),
                )
                imbalances = self.as_user(self.administrator, _IMBALANCES, (marketplace, year))
                self.assertTrue(imbalances)
                self.assertEqual({row[2:] for row in imbalances}, {(0, 0)})
        january = {
            (row[2], row[3] or row[4]): row[5:]
            for row in self.months("Amazon.com", 2026)
            if row[0] == date(2026, 1, 1)
        }
        self.assertEqual(
            january,
            {
                ("FINANCES", None): (Decimal("-6.6"), Decimal("0.5"), 19),
                # Removal rows, the storage row, the order's three SKU A amounts, the second seller.
                ("COMPANY", None): (Decimal("0.495"), Decimal("-0.1"), 7),
                ("SELBOX", "ACCOUNT_FEE"): (Decimal("-2.3"), 0, 2),
                ("SELBOX", "BALANCE_MOVEMENT"): (-1, 0, 1),
                ("SELBOX", "TAX_RECLASSIFICATION"): (Decimal("-0.25"), 0, 1),
                ("DIFFERENCE", "NO_ASSIGNMENT"): (Decimal("3.75"), 0, 3),
                ("DIFFERENCE", "REFERENCE_NOT_FOUND"): (Decimal("-0.5"), 0, 1),
                ("DIFFERENCE", "ROUNDING"): (Decimal("-0.005"), 0, 1),
                ("DIFFERENCE", "SPLIT_OWNERSHIP"): (-1, 0, 1),
                ("DIFFERENCE", "NOT_IN_LEDGER"): (-2, 0, 1),
                ("DIFFERENCE", "LEDGER_MONTH_NOT_LOADED"): (-3, 0, 1),
                ("DIFFERENCE", "NO_ID_ON_CHARGE"): (Decimal("-4.4"), 0, 2),
                # The removal rows split the 6.60 base charge into 6.00 base and 0.60 tax;
                # the storage charge of 1.20 exceeds its rounded report total by 0.19.
                ("DIFFERENCE", "TOTALS_DIFFER"): (Decimal("-0.79"), Decimal("0.6"), 2),
                # February's removal charge balances against January's anchor.
                ("DIFFERENCE", "CHARGED_IN_ANOTHER_MONTH"): (Decimal("4.4"), 0, 1),
            },
        )
        # Every reason and group the database defines occurs, so the page tests cover each.
        self.assertEqual(
            {reason for (measure, reason) in january if measure == "DIFFERENCE"},
            set(cast(list[str], self.one("select private.difference_reasons()"))),
        )
        self.assertEqual(
            {group for (measure, group) in january if measure == "SELBOX"},
            set(cast(list[str], self.one("select enum_range(null::private.selbox_group)::text[]"))),
        )

    def test_amount_counts_equal_outcome_page_rows(self) -> None:
        self.review_charges()
        # Each reason or group, and each whole outcome, against its unpaged outcome list.
        checks = self.as_user(
            self.administrator,
            """
            with months as (
                select * from public.financial_review_months('Amazon.com',2026)
                where measure in ('DIFFERENCE','SELBOX')
            ), scopes as (
                select month,measure,reason,selbox_group,base_amount,tax_amount,amount_count
                from months
                union all
                select month,measure,null,null,sum(base_amount),sum(tax_amount),sum(amount_count)
                from months group by 1,2
            )
            select s.*,p.* from scopes s cross join lateral (
                select sum(base_amount),sum(tax_amount),count(*)
                from public.financial_outcome_page(
                    s.measure,s.month,'Amazon.com',s.reason,s.selbox_group,1000,0
                )
            ) p
            """,
        )
        reasons = cast(list[str], self.one("select private.difference_reasons()"))
        groups = cast(list[str], self.one("select enum_range(null::private.selbox_group)::text[]"))
        self.assertEqual(
            {(row[1], row[2] or row[3]) for row in checks if row[0] == date(2026, 1, 1)},
            {("SELBOX", None), ("DIFFERENCE", None)}
            | {("SELBOX", group) for group in groups}
            | {("DIFFERENCE", reason) for reason in reasons},
        )
        for row in checks:
            with self.subTest(scope=row[:4]):
                self.assertEqual(row[7:], row[4:7])

    def test_outcome_pages_follow_the_complete_ordered_list(self) -> None:
        self.review_charges()
        for outcome, month, count in (
            ("DIFFERENCE", date(2026, 1, 1), 13),
            ("SELBOX", date(2026, 1, 1), 4),
            ("DIFFERENCE", date(2026, 2, 1), 1),
        ):
            with self.subTest(outcome=outcome, month=month):
                rows = self.page(outcome, month)
                expected = self.as_user(
                    self.administrator,
                    "select * from public.financial_outcomes where outcome=%s "
                    "and marketplace_name='Amazon.com' and date_trunc('month',posted_date)=%s "
                    "order by posted_date desc,source_row_id,reason",
                    (outcome, month),
                )
                self.assertEqual(len(rows), count)
                self.assertEqual(rows, expected)
                pages = [
                    row
                    for offset in range(0, count, 2)
                    for row in self.page(outcome, month, limit=2, offset=offset)
                ]
                self.assertEqual(pages, rows)

    def test_review_arguments_are_rejected_before_reading(self) -> None:
        month = date(2026, 1, 1)
        months: tuple[tuple[object, ...], ...] = (
            (None, 2026),
            ("Amazon.nowhere", 2026),
            ("Amazon.com", None),
            ("Amazon.com", 0),
            ("Amazon.com", 10000),
        )
        pages: tuple[tuple[object, ...], ...] = (
            (None, month, "Amazon.com", None, None, 50, 0),
            ("COMPANY", month, "Amazon.com", None, None, 50, 0),
            ("DIFFERENCE", None, "Amazon.com", None, None, 50, 0),
            ("DIFFERENCE", date(2026, 1, 15), "Amazon.com", None, None, 50, 0),
            ("DIFFERENCE", "infinity", "Amazon.com", None, None, 50, 0),
            ("DIFFERENCE", month, None, None, None, 50, 0),
            ("DIFFERENCE", month, "Amazon.nowhere", None, None, 50, 0),
            ("DIFFERENCE", month, "Amazon.com", None, "ACCOUNT_FEE", 50, 0),
            ("SELBOX", month, "Amazon.com", "NO_ASSIGNMENT", None, 50, 0),
            ("DIFFERENCE", month, "Amazon.com", "ROUNDING_ERRORS", None, 50, 0),
            ("DIFFERENCE", month, "Amazon.com", "", None, 50, 0),
            ("DIFFERENCE", month, "Amazon.com", "rounding", None, 50, 0),
            ("SELBOX", month, "Amazon.com", None, "SUBSCRIPTION", 50, 0),
            ("SELBOX", month, "Amazon.com", None, "", 50, 0),
            ("SELBOX", month, "Amazon.com", None, None, 0, 0),
            ("SELBOX", month, "Amazon.com", None, None, 1001, 0),
            ("SELBOX", month, "Amazon.com", None, None, 50, -1),
        )
        reads: tuple[tuple[LiteralString, tuple[tuple[object, ...], ...]], ...] = (
            (_MONTHS, months),
            (_PAGE, pages),
        )
        for query, cases in reads:
            for params in cases:
                with (
                    self.subTest(params=params),
                    self.assertRaises(psycopg.errors.InvalidParameterValue),
                ):
                    self.as_user(self.administrator, query, params)

    def test_review_rejects_member_and_unassigned_accounts(self) -> None:
        self.review_charges()
        reads: tuple[tuple[LiteralString, tuple[object, ...]], ...] = (
            (_MONTHS, ("Amazon.com", 2026)),
            (_MONTHS, (None, None)),
            (_PAGE, ("DIFFERENCE", date(2026, 1, 1), "Amazon.com", None, None, 50, 0)),
            ("select * from private.monthly_outcomes(null,null,null)", ()),
        )
        for role, company in (("member", self.company), ("unassigned", None)):
            user = self.account(role, company)
            for query, params in reads:
                with (
                    self.subTest(role=role, query=query),
                    self.assertRaises(psycopg.errors.InsufficientPrivilege),
                ):
                    self.as_user(user, query, params)
