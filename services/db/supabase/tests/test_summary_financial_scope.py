"""Summary amounts and records exclude SelBox while the transaction list retains it."""

from decimal import Decimal
from typing import cast

import psycopg

from services.db.supabase.tests.transaction_fixtures import TransactionPageFixture


class SummaryFinancialScopeTests(TransactionPageFixture):
    def test_company_totals_and_drilldowns_exclude_positive_negative_and_only_selbox_groups(
        self,
    ) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.finances(
            [
                self.transaction("100"),
                self.transaction(
                    "200", 4, activity_date="2026-06-30", category="SELBOX", kind="Adjustment"
                )
                | {"component_type": "PRODUCT_SALES", "fee_base": "200"},
                self.transaction("-20", 5, category="SELBOX", kind="Adjustment")
                | {"component_type": "PRODUCT_SALES", "fee_base": "-20"},
                self.transaction("7", 6, category="SELBOX", kind="DebtRecovery")
                | {"marketplace_name": "Amazon.ca", "currency": "CAD"},
                self.transaction("999", 7, category="DATA_KIOSK"),
            ]
        )
        self.kiosk(1, [self.component("-10"), self.component("999", category="FINANCES")])
        administrator = self.administrator()
        for user in (administrator, self.member(company)):
            payload = cast(
                dict[str, object],
                self.as_user(
                    user,
                    "select public.transaction_totals(p_date_from=>'2026-06-01',"
                    "p_date_to=>'2026-06-30')",
                )[0][0],
            )
            totals = cast(list[dict[str, object]], payload["rows"])
            self.assertEqual(len(totals), 1)
            total = totals[0]
            self.assertEqual(total["marketplace_name"], "Amazon.com")
            self.assertEqual(total["currency"], "USD")
            self.assertEqual(total["row_count"], "2")
            self.assertEqual(total["known_company_count"], "2")
            self.assertEqual(Decimal(cast(str, total["reported_amount"])), Decimal(90))
            self.assertEqual(Decimal(cast(str, total["service_fee"])), Decimal(-5))
            self.assertEqual(Decimal(cast(str, total["company_amount"])), Decimal(85))
            self.assertEqual(
                Decimal(cast(str, total["reported_amount"]))
                + Decimal(cast(str, total["service_fee"])),
                Decimal(cast(str, total["company_amount"])),
            )
            payload = cast(
                dict[str, object],
                self.as_user(
                    user,
                    "select public.transaction_totals(p_date_from=>'2026-06-01',"
                    "p_currency=>'USD',p_group_by_type=>true)",
                )[0][0],
            )
            types = cast(list[dict[str, object]], payload["rows"])
            self.assertEqual(
                {row["component_type"] for row in types}, {"PRODUCT_SALES", "FbaStorageFee"}
            )
            self.assertEqual(
                Decimal(
                    next(
                        cast(str, row["reported_amount"])
                        for row in types
                        if row["component_type"] == "PRODUCT_SALES"
                    )
                ),
                Decimal(100),
            )
            for direction in ("asc", "desc"):
                for order in ("date", "amount"):
                    rows: list[dict[str, object]] = []
                    for offset in (0, 1):
                        page = self.assert_matches_view(
                            user,
                            p_limit=1,
                            p_offset=offset,
                            p_direction=direction,
                            p_order_by=order,
                            p_include_selbox=False,
                        )
                        self.assertEqual(page["total_count"], "2")
                        rows.extend(cast(list[dict[str, object]], page["rows"]))
                    self.assertEqual({row["category"] for row in rows}, {"FINANCES", "DATA_KIOSK"})
                    self.assertEqual(
                        sum(Decimal(str(row["source_amount"])) for row in rows), Decimal(90)
                    )
            self.assertEqual(
                self.as_user(user, "select public.transaction_count(p_include_selbox=>false)"),
                [("2",)],
            )
        self.assertEqual(self.page(administrator)["total_count"], "5")
        self.assertEqual(self.as_user(administrator, "select public.transaction_count()"), [("5",)])
        anchor = self.page(administrator, p_limit=1, p_include_count=False)
        self.assertEqual(cast(list[dict[str, object]], anchor["rows"])[0]["category"], "SELBOX")
        self.assertEqual(
            self.as_user(
                administrator,
                "select public.transaction_totals(p_date_from=>'2026-06-01',"
                "p_marketplaces=>array['Amazon.ca'])",
            )[0][0],
            {"rows": [], "next_offset": None},
        )

    def test_financial_only_records_keep_uncalculated_rows_and_reject_null_preference(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.finances(
            [
                self.transaction("100"),
                self.transaction("20", 4, category="SELBOX"),
                self.transaction("7", 5, sku="UNKNOWN", description="Shipping"),
            ]
        )
        administrator = self.administrator()
        page = self.assert_matches_view(administrator, p_include_selbox=False)
        self.assertEqual(page["total_count"], "2")
        payload = cast(
            dict[str, object],
            self.as_user(
                administrator, "select public.transaction_totals(p_date_from=>'2026-06-01')"
            )[0][0],
        )
        totals = cast(list[dict[str, object]], payload["rows"])[0]
        self.assertEqual(totals["row_count"], "2")
        self.assertEqual(totals["known_company_count"], "1")
        self.assertEqual(Decimal(cast(str, totals["reported_amount"])), Decimal(107))
        self.assertEqual(Decimal(cast(str, totals["company_amount"])), Decimal(95))
        for user in (administrator, self.member(company), self.auth_user()):
            for function in ("transaction_page", "transaction_count"):
                with self.assertRaises(psycopg.errors.InvalidParameterValue):
                    self.as_user(user, f"select public.{function}(p_include_selbox=>null)")
