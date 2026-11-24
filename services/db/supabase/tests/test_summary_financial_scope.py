"""Summary amounts and drilldowns use the transaction list's authorized row set."""

from decimal import Decimal
from typing import cast

from services.db.supabase.tests.transaction_fixtures import TransactionPageFixture


class SummaryFinancialScopeTests(TransactionPageFixture):
    def test_totals_keep_uncalculated_rows_and_selbox_in_separate_company_sums(self) -> None:
        _, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.finances(
            [
                self.transaction("100"),
                self.transaction("20", 4, kind="ServiceFee", route="SELBOX")
                | {
                    "sku": None,
                    "route": "SELBOX",
                    "component_type": "SUBSCRIPTION_FEES",
                    "selbox_group": "ACCOUNT_FEE",
                },
                self.transaction("7", 5, sku="UNKNOWN", description="Shipping"),
            ]
        )
        administrator = self.administrator()
        page = self.assert_matches_view(administrator)
        self.assertEqual(page["total_count"], "2")
        payload = cast(
            dict[str, object],
            self.as_user(
                administrator, "select public.transaction_totals(p_date_from=>'2026-06-01')"
            )[0][0],
        )
        totals = cast(list[dict[str, object]], payload["rows"])[0]
        self.assertEqual(totals["row_count"], "2")
        self.assertEqual(totals["known_company_count"], "2")
        self.assertEqual(Decimal(cast(str, totals["reported_amount"])), Decimal(120))
        self.assertEqual(Decimal(cast(str, totals["company_amount"])), Decimal(95))
