"""Summary amounts and drilldowns use the transaction list's authorized row set."""

from decimal import Decimal
from typing import cast

from services.db.supabase.tests.transaction_fixtures import TransactionPageFixture


class SummaryFinancialScopeTests(TransactionPageFixture):
    def test_totals_include_visible_selbox_without_assigning_its_amount_to_a_company(self) -> None:
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
        for user, expected_count, reported in (
            (administrator, "5", Decimal(277)),
            (self.member(company), "2", Decimal(90)),
        ):
            for grouped in (False, True):
                payload = cast(
                    dict[str, object],
                    self.as_user(
                        user,
                        "select public.transaction_totals(p_date_from=>'2026-06-01',"
                        "p_date_to=>'2026-06-30',p_group_by_type=>%s)",
                        (grouped,),
                    )[0][0],
                )
                totals = cast(list[dict[str, str]], payload["rows"])
                self.assertEqual(
                    sum(Decimal(row["row_count"]) for row in totals), Decimal(expected_count)
                )
                self.assertEqual(
                    sum(Decimal(row["known_company_count"]) for row in totals),
                    Decimal(expected_count),
                )
                self.assertEqual(sum(Decimal(row["reported_amount"]) for row in totals), reported)
                self.assertEqual(sum(Decimal(row["service_fee"]) for row in totals), Decimal(-5))
                self.assertEqual(sum(Decimal(row["company_amount"]) for row in totals), Decimal(85))
                for total in totals:
                    page = self.assert_matches_view(
                        user,
                        p_date_from="2026-06-01",
                        p_date_to="2026-06-30",
                        p_marketplaces=[total["marketplace_name"]] if not grouped else None,
                        p_currency=total["currency"],
                        p_types=[total["component_type"]] if grouped else None,
                    )
                    rows = cast(list[dict[str, object]], page["rows"])
                    self.assertEqual(page["total_count"], total["row_count"])
                    for row_field, total_field in (
                        ("source_amount", "reported_amount"),
                        ("fee_amount", "service_fee"),
                        ("company_amount", "company_amount"),
                    ):
                        self.assertEqual(
                            sum(Decimal(str(row[row_field])) for row in rows),
                            Decimal(total[total_field]),
                        )
            self.assertEqual(self.page(user)["total_count"], expected_count)
            self.assertEqual(
                self.as_user(user, "select public.transaction_count()"), [(expected_count,)]
            )
        anchor = self.page(administrator, p_limit=1, p_include_count=False)
        self.assertEqual(cast(list[dict[str, object]], anchor["rows"])[0]["category"], "SELBOX")

    def test_totals_keep_uncalculated_rows_and_selbox_in_separate_company_sums(self) -> None:
        _, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.finances(
            [
                self.transaction("100"),
                self.transaction("20", 4, category="SELBOX"),
                self.transaction("7", 5, sku="UNKNOWN", description="Shipping"),
            ]
        )
        administrator = self.administrator()
        page = self.assert_matches_view(administrator)
        self.assertEqual(page["total_count"], "3")
        payload = cast(
            dict[str, object],
            self.as_user(
                administrator, "select public.transaction_totals(p_date_from=>'2026-06-01')"
            )[0][0],
        )
        totals = cast(list[dict[str, object]], payload["rows"])[0]
        self.assertEqual(totals["row_count"], "3")
        self.assertEqual(totals["known_company_count"], "2")
        self.assertEqual(Decimal(cast(str, totals["reported_amount"])), Decimal(127))
        self.assertEqual(Decimal(cast(str, totals["company_amount"])), Decimal(95))
