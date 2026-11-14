"""Category authority counts only real source components without double-counting."""

from datetime import date, timedelta
from decimal import Decimal
from typing import cast

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.transaction_fixtures import TransactionPageFixture


class FinancialSourceAuthorityTests(TransactionPageFixture):
    def test_payout_cutoff_uses_two_calendar_months_in_every_session_timezone(self) -> None:
        expected = require_row(
            self.connection.execute(
                "select ((current_timestamp at time zone 'UTC')::date - interval '2 months')::date"
            ).fetchone()
        )[0]
        for timezone in ("Pacific/Kiritimati", "Pacific/Honolulu", "UTC"):
            self.connection.execute("select set_config('TimeZone',%s,true)", (timezone,))
            self.assertEqual(self.mature_cutoff_date(), expected)

    def test_source_categories_apply_to_historical_and_current_dates(self) -> None:
        current = date.fromisoformat(self.current_activity_date())
        before = date(2026, 6, 15)
        company, sku = self.owner()
        terms = self.fee(sku, [(date(before.year, 1, 1).isoformat(), None, "10")])
        self.finances(
            [
                self.transaction("100", 3, activity_date=before.isoformat()),
                self.transaction("-5", 4, activity_date=before.isoformat(), category="SELBOX"),
                self.transaction("-8", 5, activity_date=before.isoformat(), category="DATA_KIOSK"),
                self.transaction("1000", 6, activity_date=current.isoformat()),
                self.transaction("-999", 7, activity_date=current.isoformat(), category="SELBOX"),
                self.transaction(
                    "-100", 8, activity_date=current.isoformat(), category="DATA_KIOSK"
                )
                | {"sku": None},
                self.transaction(
                    "10000",
                    9,
                    activity_date=current.isoformat(),
                    kind="Transfer",
                    category="SELBOX",
                )
                | {"activity_eligible": False},
            ]
        )
        kiosk_versions: list[str] = []
        for number, day, sales, retained, costs in (
            (1, before, "900", "-99", "-10"),
            (2, current, "200", "-7", "-20"),
        ):
            _, kiosk_version = self.kiosk(
                number,
                [
                    self.component(sales, category="FINANCES")
                    | {"component_type": "NET_PRODUCT_SALES", "fee_base": sales},
                    self.component(retained, category="SELBOX") | {"sku": None},
                    self.component(costs),
                    self.component("999", category="ANALYSIS_ONLY"),
                ],
                activity_date=day.isoformat(),
            )
            kiosk_versions.append(kiosk_version)
        administrator, member = self.administrator(), self.member(company)
        self.assertEqual(
            self.as_user(administrator, "select public.source_transaction_count('finances')"),
            [("7",)],
        )
        for user, count in ((administrator, "6"), (member, "4")):
            page = self.assert_matches_view(user, p_direction="asc")
            self.assertEqual(page["total_count"], count)
            totals = self.as_user(
                user, "select public.transaction_totals(p_date_from => %s)", (before,)
            )[0][0]
            total = cast(dict[str, list[dict[str, str]]], totals)["rows"][0]
            self.assertEqual(
                Decimal(total["reported_amount"]), Decimal(66 if user == administrator else 1070)
            )
            self.assertEqual(Decimal(total["service_fee"]), Decimal(-110))
            self.assertEqual(Decimal(total["company_amount"]), Decimal(960))
            self.assertEqual(total["row_count"], count)
        self.assertEqual(
            self.page(administrator, p_company_ids=[company])["rows"], self.page(member)["rows"]
        )
        retained_rows = [
            row
            for row in cast(list[dict[str, object]], self.page(administrator)["rows"])
            if row["category"] == "SELBOX"
        ]
        self.assertEqual(len(retained_rows), 2)
        for row in retained_rows:
            self.assertIsNone(row["company_id"])
            self.assertIsNone(row["terms_version_id"])
            self.assertEqual(row["company_amount"], "0")
            self.assertEqual(row["fee_amount"], "0")
            self.assertEqual(row["resolution_status"], "NOT_APPLICABLE")
        details = self.connection.execute(
            "select source_amount,authoritative,fee_amount,company_amount "
            "from private.resolve_company_components(%s::uuid[],%s::uuid[],%s::uuid[]) "
            "where source='DATA_KIOSK' and activity_date=%s and category='FINANCES'",
            (
                self.finances_versions(*self.last_finances_batch_ids),
                kiosk_versions,
                [terms],
                before,
            ),
        ).fetchall()
        self.assertEqual(details, [(Decimal(900), False, None, None)])
        for user in (administrator, member):
            expected = self.as_user(
                user,
                "select public.transaction_page(),public.transaction_count(),"
                "public.transaction_totals(p_date_from=>'2026-01-01')",
            )
            for cutoff in (date(2000, 1, 1), date(2100, 1, 1)):
                with self.subTest(cutoff=cutoff), self.connection.transaction(force_rollback=True):
                    self.set_mature_cutoff_date(cutoff)
                    self.assertEqual(
                        self.as_user(
                            user,
                            "select public.transaction_page(),public.transaction_count(),"
                            "public.transaction_totals(p_date_from=>'2026-01-01')",
                        ),
                        expected,
                    )

    def test_strict_reads_validate_every_date_and_accept_unallocated_cost_controls(
        self,
    ) -> None:
        mature_cutoff_date = self.mature_cutoff_date()
        before = mature_cutoff_date - timedelta(days=1)
        self.owner()
        finances, _ = self.finances(
            [
                self.transaction("-8", activity_date=before.isoformat(), category="DATA_KIOSK")
                | {"sku": None}
            ]
        )
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "Data Kiosk day coverage"),
            self.connection.transaction(),
        ):
            self.connection.execute(
                "select private.assert_company_source_scope("
                "%s,%s,%s,'v0',%s::uuid[],array['Amazon.com'])",
                (self.seller, before, before, [finances]),
            )
        self.kiosk(1, [self.component("-10")], activity_date=before.isoformat())
        self.assertEqual(
            self.connection.execute(
                "select source_amount from private.company_financial_totals("
                "%s,%s,%s,'v0',%s::uuid[],array['Amazon.com'])",
                (self.seller, before, before, [finances]),
            ).fetchall(),
            [(Decimal(-10),)],
        )
        self.kiosk(2, [self.component("30")], activity_date=mature_cutoff_date.isoformat())
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "select source_amount from private.company_financial_totals("
                "%s,%s,%s,'v0',array['00000000-0000-0000-0000-000000000001']::uuid[],"
                "array['Amazon.com'])",
                (self.seller, mature_cutoff_date, mature_cutoff_date),
            )
        self.assertEqual(
            self.connection.execute(
                "select source_amount from private.company_financial_totals("
                "%s,%s,%s,'v0','{}',array['Amazon.com'])",
                (self.seller, mature_cutoff_date, mature_cutoff_date),
            ).fetchall(),
            [(Decimal(30),)],
        )

    def test_raw_source_totals_preserve_unmatched_categories_and_dimensions(self) -> None:
        day = date.fromisoformat(self.current_activity_date())
        earlier = day - timedelta(days=1)
        company, _ = self.owner()
        self.finances(
            [
                self.transaction("100", 3, activity_date=day.isoformat()),
                self.transaction("-5", 4, activity_date=day.isoformat(), category="SELBOX"),
                self.transaction("-8", 5, activity_date=day.isoformat(), category="DATA_KIOSK"),
                self.transaction("-3", 6, activity_date=day.isoformat(), category="DATA_KIOSK")
                | {
                    "sku": None,
                    "marketplace_name": "Non-Amazon US",
                    "transaction_type": "ServiceFee",
                },
                self.transaction("-4", 7, activity_date=day.isoformat(), category="DATA_KIOSK")
                | {"marketplace_name": "Amazon.ca"},
            ]
        )
        self.kiosk(
            1,
            [
                self.component("900", category="FINANCES"),
                self.component("-99", category="SELBOX") | {"sku": None},
                self.component("-10"),
                self.component("-1") | {"currency": "EUR"},
            ],
            activity_date=day.isoformat(),
        )
        self.kiosk(2, [self.component("-11")], activity_date=earlier.isoformat())
        administrator = self.administrator()
        actual: list[tuple[str, str, str, str, str, Decimal]] = []
        for marketplace in ("Amazon.com", "Amazon.ca", "Non-Amazon US"):
            result = cast(
                dict[str, object],
                self.as_user(
                    administrator,
                    "select public.current_source_totals(%s,%s,%s,'day')",
                    (earlier, day, marketplace),
                )[0][0],
            )
            for row in cast(list[dict[str, str]], result["rows"]):
                actual.append(
                    (
                        row["period"],
                        row["marketplace_name"],
                        row["currency"],
                        row["source"],
                        row["category"],
                        Decimal(row["amount"]),
                    )
                )
        self.assertCountEqual(
            actual,
            [
                (earlier.isoformat(), "Amazon.com", "USD", "DATA_KIOSK", "DATA_KIOSK", -11),
                (day.isoformat(), "Non-Amazon US", "USD", "FINANCES", "DATA_KIOSK", -3),
                (day.isoformat(), "Amazon.ca", "USD", "FINANCES", "DATA_KIOSK", -4),
                (day.isoformat(), "Amazon.com", "EUR", "DATA_KIOSK", "DATA_KIOSK", -1),
                (day.isoformat(), "Amazon.com", "USD", "FINANCES", "FINANCES", 100),
                (day.isoformat(), "Amazon.com", "USD", "FINANCES", "SELBOX", -5),
                (day.isoformat(), "Amazon.com", "USD", "FINANCES", "DATA_KIOSK", -8),
                (day.isoformat(), "Amazon.com", "USD", "DATA_KIOSK", "FINANCES", 900),
                (day.isoformat(), "Amazon.com", "USD", "DATA_KIOSK", "SELBOX", -99),
                (day.isoformat(), "Amazon.com", "USD", "DATA_KIOSK", "DATA_KIOSK", -10),
            ],
        )

        for user in (self.member(company), self.auth_user()):
            with self.subTest(user=user), self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(
                    user,
                    "select public.current_source_totals(%s,%s,'Amazon.com')",
                    (earlier, day),
                )

    def test_kiosk_sales_stay_supporting_without_finance_activity(self) -> None:
        before = date.fromisoformat(self.current_activity_date())
        company, _ = self.owner()
        self.kiosk(
            1,
            [
                self.component("100", category="FINANCES")
                | {"component_type": "NET_PRODUCT_SALES", "fee_base": "100"},
                self.component("-10"),
            ],
            activity_date=before.isoformat(),
        )
        member = self.member(company)
        self.assertEqual(self.page(member)["total_count"], "1")
        self.assertEqual(
            self.connection.execute(
                "select source_amount from private.company_financial_totals("
                "%s,%s,%s,'v0',array[]::uuid[],array['Amazon.com'])",
                (self.seller, before, before),
            ).fetchall(),
            [(Decimal(-10),)],
        )
