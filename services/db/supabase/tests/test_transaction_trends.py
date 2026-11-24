"""UTC trend buckets preserve exact transaction filters, fees, and access."""

from itertools import product
from typing import cast

from services.db.supabase.tests.search_fixtures import LIVE_SEARCH_FIELDS
from services.db.supabase.tests.transaction_totals_fixture import TransactionTotalsFixture


class TransactionTrendTests(TransactionTotalsFixture):
    def test_daily_and_weekly_groups_match_filtered_rows_for_every_role(self) -> None:
        first, second = self.financial_fixture()
        users = (self.administrator(), self.member(first), self.member(second), self.auth_user())
        filters: tuple[dict[str, object], ...] = (
            {},
            {"p_sources": ["FINANCES"]},
            {"p_sources": ["AD_INVOICE"]},
            {"p_types": ["PRODUCT_SALES", "FbaStorageFee"]},
            {"p_fee_applicable": True},
            {"p_fee_applicable": False},
            {"p_search_skus": ["SKU"]},
            {"p_search_types": ["FbaStorageFee"]},
            {"p_search_marketplaces": ["Amazon.com"]},
            {"p_search_sources": ["AD_INVOICE"]},
            {name: [] for name in LIVE_SEARCH_FIELDS},
            {"p_company_ids": [first]},
            {"p_company_ids": [second]},
            {"p_skus": ["GAP", "UNKNOWN", "UNASSIGNED"]},
            {"p_marketplaces": ["Amazon.com"], "p_currency": "USD"},
            {"p_date_from": None, "p_date_to": "2026-06-15"},
            {
                "p_date_from": "2026-06-15",
                "p_date_to": "2026-06-16",
                "p_company_ids": [first],
                "p_skus": ["SKU"],
                "p_marketplaces": ["Amazon.com"],
                "p_currency": "USD",
                "p_sources": ["FINANCES"],
                "p_types": ["PRODUCT_SALES"],
                "p_fee_applicable": True,
                "p_search_skus": ["SKU"],
            },
        )
        for user, granularity, options in product(users, ("day", "week"), filters):
            with self.subTest(user=user, granularity=granularity, filters=options):
                self.assert_matches_view(user, p_granularity=granularity, **options)

    def test_marketplace_currency_type_and_bucket_groups_remain_separate(self) -> None:
        company, _ = self.owner()
        self.finances(
            [
                self.transaction("10", 1, description="Shipping", activity_date="2025-12-31"),
                self.transaction("20", 2, description="Shipping", activity_date="2026-01-01"),
                self.transaction("30", 3, description="Shipping", activity_date="2026-01-05"),
                self.transaction("40", 4, description="Shipping", activity_date="2026-01-05")
                | {"marketplace_name": "Amazon.ca"},
                self.transaction("50", 5, description="Shipping", activity_date="2026-01-05")
                | {"currency": "EUR"},
            ]
        )
        member = self.member(company)
        for granularity, grouped in product(("day", "week"), (False, True)):
            options = {
                "p_granularity": granularity,
                "p_group_by_type": grouped,
                "p_date_from": "2025-12-31",
                "p_date_to": "2026-01-31",
            }
            rows = cast(list[dict[str, str]], self.assert_matches_view(member, **options)["rows"])
            self.assertTrue(all(row["marketplace_name"] and row["component_type"] for row in rows))
            if granularity == "week":
                self.assertIn("2025-12-29", {row["period_start"] for row in rows})
                self.assertEqual(len(rows), 4)

    def test_more_than_one_thousand_trend_groups_are_complete_and_ordered(self) -> None:
        company, _ = self.owner()
        self.finances(
            [
                self.transaction(str(number), number + 3, description=f"Type-{number:04}")
                for number in range(1004)
            ]
        )
        user = self.member(company)
        for granularity in ("day", "week"):
            result = self.assert_matches_view(user, p_granularity=granularity)
            self.assertEqual(result["group_count"], "1004")
            self.assertEqual(len(cast(list[object], result["rows"])), 1004)
