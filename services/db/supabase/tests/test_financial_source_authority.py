"""Category authority counts only real source components without double-counting."""

from datetime import date, timedelta
from decimal import Decimal
from typing import cast

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.transaction_fixtures import TransactionPageFixture


class FinancialSourceAuthorityTests(TransactionPageFixture):
    def test_mature_cutoff_date_uses_two_calendar_months_in_every_session_timezone(self) -> None:
        expected = require_row(
            self.connection.execute(
                "select ((current_timestamp at time zone 'UTC')::date - interval '2 months')::date"
            ).fetchone()
        )[0]
        for timezone in ("Pacific/Kiritimati", "Pacific/Honolulu", "UTC"):
            self.connection.execute("select set_config('TimeZone',%s,true)", (timezone,))
            self.assertEqual(self.mature_cutoff_date(), expected)

    def test_category_boundaries_preserve_company_entitlement(self) -> None:
        mature_cutoff_date = self.mature_cutoff_date()
        before = mature_cutoff_date - timedelta(days=1)
        company, sku = self.owner()
        terms = self.fee(sku, [(date(before.year, 1, 1).isoformat(), None, "10")])
        finances, _ = self.finances(
            [
                self.transaction("100", 3, activity_date=before.isoformat()),
                self.transaction("-5", 4, activity_date=before.isoformat(), category="SELBOX"),
                self.transaction("-8", 5, activity_date=before.isoformat(), category="DATA_KIOSK"),
                self.transaction("1000", 6, activity_date=mature_cutoff_date.isoformat()),
                self.transaction(
                    "-999", 7, activity_date=mature_cutoff_date.isoformat(), category="SELBOX"
                ),
                self.transaction(
                    "-100", 8, activity_date=mature_cutoff_date.isoformat(), category="DATA_KIOSK"
                )
                | {"sku": None},
            ]
        )
        kiosk_observations: list[str] = []
        for number, day, sales, retained, costs in (
            (1, before, "900", "-99", "-10"),
            (2, mature_cutoff_date, "200", "-7", "-20"),
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
            kiosk_observations.append(self.kiosk_observation(kiosk_version))
        administrator, member = self.administrator(), self.member(company)
        for user, count, reported in ((administrator, "6", "258"), (member, "4", "270")):
            page = self.assert_matches_view(user, p_direction="asc")
            self.assertEqual(page["total_count"], count)
            totals = self.as_user(
                user, "select public.transaction_totals(p_date_from => %s)", (before,)
            )[0][0]
            total = cast(dict[str, list[dict[str, str]]], totals)["rows"][0]
            self.assertEqual(Decimal(total["reported_amount"]), Decimal(reported))
            self.assertEqual(Decimal(total["service_fee"]), Decimal(-30))
            self.assertEqual(Decimal(total["company_amount"]), Decimal(240))
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
            ([finances], kiosk_observations, [terms], before),
        ).fetchall()
        self.assertEqual(details, [(Decimal(900), False, None, None)])
        strict = self.connection.execute(
            "select source_amount,fee_amount,company_amount from private.company_financial_totals("
            "%s,%s,%s,'v0',%s::uuid[],array['Amazon.com'])",
            (self.seller, before, mature_cutoff_date, [finances]),
        ).fetchall()
        self.assertEqual(strict, [(Decimal(270), Decimal(-30), Decimal(240))])

    def test_strict_reads_require_mature_kiosk_coverage_and_accept_unallocated_cost_controls(
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
        self.assertEqual(
            self.connection.execute(
                "select source_amount from private.company_financial_totals("
                "%s,%s,%s,'v0',array['00000000-0000-0000-0000-000000000001']::uuid[],"
                "array['Amazon.com'])",
                (self.seller, mature_cutoff_date, mature_cutoff_date),
            ).fetchall(),
            [(Decimal(30),)],
        )

    def test_raw_source_totals_preserve_unmatched_categories_and_dimensions(self) -> None:
        day = self.mature_cutoff_date() - timedelta(days=1)
        earlier = day - timedelta(days=1)
        self.owner()
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

    def test_mature_kiosk_authority_excludes_finances_but_includes_costs(self) -> None:
        before = self.mature_cutoff_date() - timedelta(days=1)
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
