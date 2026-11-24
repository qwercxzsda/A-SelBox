"""The bounded transaction RPC preserves live-view filtering, RLS, and exact money."""

from decimal import Decimal, localcontext
from itertools import combinations, product
from typing import cast

from services.db.supabase.tests.transaction_fixtures import (
    TRANSACTION_ARRAY_FILTERS,
    TransactionPageFixture,
)


class TransactionPageTests(TransactionPageFixture):
    def test_all_roles_preserve_exact_rows_null_states_and_visibility(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user, count in (
            (self.administrator(), "8"),
            (self.member(company_a), "6"),
            (self.member(company_b), "1"),
            (self.auth_user(), "0"),
        ):
            with self.subTest(user=user):
                page = self.assert_matches_view(user, p_include_count=True)
                self.assertEqual(page["total_count"], count)
        rows = cast(list[dict[str, object]], self.page(self.administrator())["rows"])
        self.assertEqual(
            {row["resolution_status"] for row in rows},
            {"APPLIED", "NOT_APPLICABLE", "MISSING_FEE"},
        )
        precise = next(row for row in rows if row["source_amount"] == "100.123456789012345678901")
        self.assertEqual(precise["fee_base"], "100.123456789012345678901")
        with localcontext() as context:
            context.prec = 80
            expected_fee = -Decimal("100.123456789012345678901") * Decimal("0.05125")
            self.assertEqual(Decimal(cast(str, precise["fee_amount"])), expected_fee)
            self.assertEqual(
                Decimal(cast(str, precise["company_amount"])),
                Decimal("100.123456789012345678901") + expected_fee,
            )
        self.assertTrue(
            any(row["source"] == "FINANCES" and row["source_amount"] == "0" for row in rows)
        )

    def test_every_filter_combination_matches_the_live_view(self) -> None:
        company_a, _ = self.financial_fixture()
        filters: dict[str, object] = {
            "p_date_from": "2026-06-15",
            "p_date_to": "2026-06-16",
            "p_company_ids": [company_a],
            "p_skus": ["SKU"],
            "p_marketplaces": ["Amazon.com"],
            "p_sources": ["AD_INVOICE"],
            "p_types": ["FbaStorageFee"],
        }
        users = (self.administrator(), self.member(company_a))
        for size in range(len(filters) + 1):
            for names in combinations(filters, size):
                options = {name: filters[name] for name in names}
                for user in users:
                    with self.subTest(user=user, filters=names):
                        self.assert_matches_view(user, p_limit=3, p_include_count=True, **options)

    def test_multiselect_empty_arrays_and_unknown_filters_do_not_change_scope(self) -> None:
        company_a, company_b = self.financial_fixture()
        member = self.member(company_a)
        empty_selections: tuple[object, ...] = (None, [])
        for user in (self.administrator(), member):
            for empty in empty_selections:
                with self.subTest(user=user, empty=empty):
                    options = dict.fromkeys(TRANSACTION_ARRAY_FILTERS, empty)
                    self.assert_matches_view(user, p_date_from=None, p_date_to=None, **options)
            self.assert_matches_view(
                user,
                p_company_ids=[company_a, company_b, company_a],
                p_skus=["SKU", "OTHER", "GAP", "SKU"],
                p_marketplaces=["Amazon.com", "Amazon.co.uk"],
                p_sources=["AD_INVOICE", "FINANCES"],
                p_types=["FbaStorageFee", "PRODUCT_SALES", "PRODUCT_REFUNDS"],
            )
            for filters in ({"p_skus": ["unknown SKU"]}, {"p_marketplaces": ["Amazon.co.uk"]}):
                self.assertEqual(self.assert_matches_view(user, **filters)["rows"], [])
        self.assertEqual(
            self.assert_matches_view(member, p_company_ids=[company_b]),
            {"rows": [], "total_count": "0"},
        )

    def test_date_and_amount_directions_offsets_and_count_modes(self) -> None:
        company, _ = self.financial_fixture()
        for user, ordering, direction, offset, include_count in product(
            (self.administrator(), self.member(company)),
            ("date", "amount"),
            ("asc", "desc"),
            (0, 3, 19, 9007199254740991),
            (False, True),
        ):
            with self.subTest(user=user, direction=direction, offset=offset, count=include_count):
                self.assert_matches_view(
                    user,
                    p_direction=direction,
                    p_limit=3,
                    p_offset=offset,
                    p_order_by=ordering,
                    p_include_count=include_count,
                )

    def test_date_probe_retries_past_hidden_rows_in_both_directions(self) -> None:
        company, _ = self.owner("VISIBLE")
        self.owner("OTHER")
        # Fill both ends of the time index with another company's transactions.
        # Neither edge contains enough matching rows for the requested offset.
        rows = [
            self.transaction("1", index + 3, sku="OTHER", activity_date=day)
            for day in ("2026-06-01", "2026-06-03")
            for index in range(70)
        ]
        rows.extend(
            self.transaction("5", index + 3, sku="VISIBLE", activity_date="2026-06-02")
            for index in range(3)
        )
        self.finances(rows)
        for user in (self.member(company), self.administrator()):
            for direction in ("asc", "desc"):
                with self.subTest(user=user, direction=direction):
                    page = self.assert_matches_view(
                        user,
                        p_skus=["VISIBLE"],
                        p_direction=direction,
                        p_offset=1,
                        p_limit=2,
                        p_include_count=False,
                    )
                    self.assertEqual(len(cast(list[object], page["rows"])), 2)
                    self.assertIsNone(page["total_count"])

    def test_each_selection_applies_before_a_source_is_limited(self) -> None:
        company_a, company_b = self.financial_fixture()
        selections: tuple[dict[str, object], ...] = (
            {"p_date_from": "2026-07-01"},
            {"p_date_to": "2026-06-15"},
            {"p_company_ids": [company_b]},
            {"p_skus": ["OTHER"]},
            {"p_marketplaces": ["Amazon.co.uk"]},
            {"p_sources": ["AD_INVOICE"]},
            {"p_types": ["FbaStorageFee"]},
            {"p_fee_applicable": True},
            {"p_fee_applicable": False},
            {"p_skus": ["OTHER"], "p_sources": ["AD_INVOICE"]},
        )
        for user, ordering, filters, include_count in product(
            (self.administrator(), self.member(company_a), self.member(company_b)),
            ("date", "amount"),
            selections,
            (False, True),
        ):
            with self.subTest(filters=filters, count=include_count):
                self.assert_matches_view(
                    user,
                    p_direction="desc",
                    p_order_by=ordering,
                    p_limit=1,
                    p_include_count=include_count,
                    **filters,
                )

    def test_zero_fee_base_is_distinct_from_a_non_applicable_fee(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.assign("GAP", company)
        self.finances(
            [
                self.transaction("0", 3),
                self.transaction("0", 4, sku="GAP"),
                self.transaction("0", 5, description="Shipping"),
            ]
        )
        page = self.assert_matches_view(self.member(company), p_limit=1000)
        rows = cast(list[dict[str, object]], page["rows"])
        self.assertEqual(page["total_count"], "3")
        by_status = {row["resolution_status"]: row for row in rows}
        self.assertEqual(set(by_status), {"APPLIED", "MISSING_FEE", "NOT_APPLICABLE"})
        self.assertEqual(by_status["APPLIED"]["fee_base"], "0")
        self.assertEqual(Decimal(cast(str, by_status["APPLIED"]["fee_amount"])), Decimal(0))
        self.assertEqual(by_status["MISSING_FEE"]["fee_base"], "0")
        self.assertIsNone(by_status["MISSING_FEE"]["company_amount"])
        self.assertIsNone(by_status["NOT_APPLICABLE"]["fee_base"])
        self.assertEqual(by_status["NOT_APPLICABLE"]["company_amount"], "0")

    def test_fee_applicability_filters_partition_every_role_before_paging(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user in (
            self.administrator(),
            self.member(company_a),
            self.member(company_b),
            self.auth_user(),
        ):
            all_rows = self.assert_matches_view(user, p_limit=1000, p_fee_applicable=None)["rows"]
            partitions: list[dict[str, object]] = []
            for applicable in (True, False):
                filtered = self.assert_matches_view(user, p_fee_applicable=applicable, p_limit=1000)
                rows = cast(list[dict[str, object]], filtered["rows"])
                self.assertTrue(all((row["fee_base"] is not None) == applicable for row in rows))
                self.assertEqual(int(cast(str, filtered["total_count"])), len(rows))
                partitions.extend(rows)
                for direction, include_count in product(("asc", "desc"), (False, True)):
                    self.assert_matches_view(
                        user,
                        p_fee_applicable=applicable,
                        p_direction=direction,
                        p_limit=1,
                        p_offset=1,
                        p_include_count=include_count,
                    )
            self.assertEqual(len(partitions), len(cast(list[object], all_rows)))

    def test_reported_amount_order_is_independent_of_fee_adjusted_amount(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "50")])
        self.assign("OTHER", company, rate="0")
        self.finances([self.transaction("100", 3), self.transaction("90", 4, sku="OTHER")])
        member = self.member(company)
        page = self.assert_matches_view(member, p_order_by="amount", p_limit=1)
        rows = cast(list[dict[str, object]], page["rows"])
        self.assertEqual(rows[0]["source_amount"], "100")
        self.assertEqual(Decimal(cast(str, rows[0]["company_amount"])), Decimal("50"))
        self.assertEqual(page["total_count"], "2")
