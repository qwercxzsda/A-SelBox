"""Financial SKU/company selections exclude account controls carrying raw SKU text."""

from decimal import Decimal
from typing import cast

from services.db.supabase.tests.source_fixtures import SourceModelFixture


class RetainedFinancialSelectionTests(SourceModelFixture):
    def test_sku_selection_excludes_retained_amounts_from_pages_counts_and_totals(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.settlement(
            [
                self.transaction("100"),
                self.transaction("40", 4, kind="Adjustment", category="SELBOX") | {"family": None},
                self.transaction("-12", 5, kind="ServiceFee", category="DATA_KIOSK")
                | {"sku": None},
            ]
        )
        self.kiosk(1, [self.component("-10")])
        operator = self.operator()
        for user in (operator, self.member(company)):
            for direction in ("asc", "desc"):
                for ordering in ("date", "amount"):
                    with self.subTest(user=user, direction=direction, ordering=ordering):
                        page = cast(
                            dict[str, object],
                            self.as_user(
                                user,
                                "select public.transaction_page(p_skus=>array['SKU'],"
                                "p_direction=>%s,"
                                "p_order_by=>%s)",
                                (direction, ordering),
                            )[0][0],
                        )
                        rows = cast(list[dict[str, object]], page["rows"])
                        self.assertEqual(page["total_count"], "2")
                        self.assertEqual(
                            {row["category"] for row in rows}, {"SETTLEMENT", "DATA_KIOSK"}
                        )
                        self.assertEqual(
                            sum(Decimal(str(row["source_amount"])) for row in rows), Decimal(90)
                        )
            self.assertEqual(
                self.as_user(user, "select public.transaction_count(p_skus=>array['SKU'])"),
                [("2",)],
            )
            summary = cast(
                dict[str, object],
                self.as_user(
                    user,
                    "select public.transaction_totals(p_date_from=>'2026-06-01',"
                    "p_skus=>array['SKU'])",
                )[0][0],
            )
            rows = cast(list[dict[str, object]], summary["rows"])
            self.assertEqual(len(rows), 1)
            self.assertEqual(Decimal(str(rows[0]["reported_amount"])), Decimal(90))
            self.assertEqual(Decimal(str(rows[0]["company_amount"])), Decimal(85))
        self.assertEqual(
            self.as_user(
                operator,
                "select public.transaction_count(p_skus=>array['SKU'],"
                "p_sources=>array['RECONCILIATION'])",
            ),
            [("0",)],
        )
        self.assertEqual(
            self.as_user(
                operator,
                "select public.transaction_count(p_company_ids=>array[%s]::uuid[])",
                (company,),
            ),
            [("2",)],
        )
        self.assertEqual(
            self.as_user(
                operator, "select public.transaction_count(p_sources=>array['RECONCILIATION'])"
            ),
            [("1",)],
        )
        # Raw source inspection/search retains supplied SKU text and category provenance.
        self.assertEqual(
            self.as_user(
                operator,
                "select public.source_transaction_count('settlement',p_skus=>array['SKU'])",
            ),
            [("2",)],
        )
        self.assertEqual(
            self.as_user(operator, "select public.transaction_count(p_search_skus=>array['SKU'])"),
            [("3",)],
        )
        self.connection.execute("set constraints all immediate")
