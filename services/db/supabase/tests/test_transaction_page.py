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
            (self.operator(), "20"),
            (self.member(company_a), "10"),
            (self.member(company_b), "2"),
            (self.auth_user(), "0"),
        ):
            with self.subTest(user=user):
                page = self.assert_matches_view(user, p_include_count=True)
                self.assertEqual(page["total_count"], count)
        rows = cast(list[dict[str, object]], self.page(self.operator())["rows"])
        self.assertEqual(
            {row["resolution_status"] for row in rows},
            {"APPLIED", "NOT_APPLICABLE", "MISSING_FEE", "MISSING_OWNERSHIP"},
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
            any(row["source"] == "SETTLEMENT" and row["source_amount"] == "0" for row in rows)
        )
        self.assertTrue(
            any(row["source"] == "DATA_KIOSK" and row["source_amount"] == "0" for row in rows)
        )

    def test_every_filter_combination_matches_the_live_view(self) -> None:
        company_a, _ = self.financial_fixture()
        filters: dict[str, object] = {
            "p_date_from": "2026-06-15",
            "p_date_to": "2026-06-16",
            "p_company_ids": [company_a],
            "p_skus": ["SKU"],
            "p_marketplaces": ["Amazon.com"],
            "p_sources": ["DATA_KIOSK"],
            "p_types": ["FbaStorageFee"],
        }
        users = (self.operator(), self.member(company_a))
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
        for user in (self.operator(), member):
            for empty in empty_selections:
                with self.subTest(user=user, empty=empty):
                    options = dict.fromkeys(TRANSACTION_ARRAY_FILTERS, empty)
                    self.assert_matches_view(user, p_date_from=None, p_date_to=None, **options)
            self.assert_matches_view(
                user,
                p_company_ids=[company_a, company_b, company_a],
                p_skus=["SKU", "OTHER", "GAP", "SKU"],
                p_marketplaces=["Amazon.com", "Amazon.co.uk"],
                p_sources=["DATA_KIOSK", "SETTLEMENT"],
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
            (self.operator(), self.member(company)),
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

    def test_page_boundaries_preserve_every_tied_row_once(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        settlement_rows = [self.transaction("10", line) for line in range(3, 13)]
        kiosk_rows = [self.component("10") for _ in range(10)]
        # Fact IDs are unique within a source, not across both source tables.
        kiosk_rows[0]["id"] = settlement_rows[0]["id"]
        self.settlement(settlement_rows)
        self.kiosk(1, kiosk_rows, activity_date=self.recent_activity_date())
        user = self.member(company)
        for ordering, direction in product(("date", "amount"), ("asc", "desc")):
            with self.subTest(ordering=ordering, direction=direction):
                rows: list[object] = []
                for offset in range(0, 21, 3):
                    page = self.page(
                        user, p_direction=direction, p_order_by=ordering, p_limit=3, p_offset=offset
                    )
                    rows.extend(cast(list[object], page["rows"]))
                    self.assertEqual(page["total_count"], "20")
                expected = self.expected(
                    user, p_direction=direction, p_order_by=ordering, p_limit=1000
                )
                self.assertEqual(rows, expected["rows"])
                self.assertEqual(len(rows), 20)

    def test_each_selection_applies_before_a_source_is_limited(self) -> None:
        company_a, company_b = self.financial_fixture()
        selections: tuple[dict[str, object], ...] = (
            {"p_date_from": "2026-07-01"},
            {"p_date_to": "2026-06-15"},
            {"p_company_ids": [company_b]},
            {"p_skus": ["OTHER"]},
            {"p_marketplaces": ["Amazon.co.uk"]},
            {"p_sources": ["DATA_KIOSK"]},
            {"p_types": ["FbaStorageFee"]},
            {"p_fee_applicable": True},
            {"p_fee_applicable": False},
            {"p_skus": ["OTHER"], "p_sources": ["DATA_KIOSK"]},
        )
        for user, ordering, filters, include_count in product(
            (self.operator(), self.member(company_a), self.member(company_b)),
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

    def test_empty_or_zero_current_kiosk_versions_cannot_restore_historical_rows(self) -> None:
        company, sku = self.owner()
        other_company, _ = self.owner("OTHER")
        self.fee(sku, [("2026-01-01", None, "5")])
        self.settlement([self.transaction("200")])
        _, previous = self.kiosk(1, [self.component("999"), self.component("-999")])
        historical = previous
        users = (
            (self.operator(), "1"),
            (self.member(company), "1"),
            (self.member(other_company), "0"),
            (self.auth_user(), "0"),
        )
        for observation, replacement in ((2, []), (3, [self.component("0")])):
            _, previous = self.kiosk(observation, replacement, expected=previous)
            self.assertEqual(
                self.connection.execute(
                    "select count(*) from private.data_kiosk_transactions where version_id=%s",
                    (historical,),
                ).fetchone(),
                (2,),
            )
            for (user, count), direction, include_count in product(
                users, ("asc", "desc"), (False, True)
            ):
                with self.subTest(
                    replacement=observation, direction=direction, count=include_count
                ):
                    page = self.assert_matches_view(
                        user,
                        p_direction=direction,
                        p_limit=1,
                        p_include_count=include_count,
                    )
                    expected = int(count) + (1 if observation == 3 and count != "0" else 0)
                    self.assertEqual(page["total_count"], str(expected) if include_count else None)
                    rows = cast(list[dict[str, object]], page["rows"])
                    self.assertEqual(len(rows), min(expected, 1))
                    self.assertTrue(all(row["source_version_id"] != historical for row in rows))
                    self.assertTrue(
                        all(
                            row["source"] != "DATA_KIOSK" or row["source_amount"] == "0"
                            for row in rows
                        )
                    )

    def test_zero_fee_base_is_distinct_from_a_non_applicable_fee(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.assign("GAP", company)
        self.settlement(
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
            self.operator(),
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

    def test_zero_base_zero_rate_and_missing_configuration_remain_fee_applicable(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.assign("GAP", company)
        self.assign("UNASSIGNED", None)
        self.assign("ZERO-RATE", company, rate="0")
        self.settlement(
            [
                self.transaction("0", 3),
                self.transaction("0", 4, sku="GAP"),
                self.transaction("1", 5, sku="UNASSIGNED"),
                self.transaction("2", 6, description="Shipping"),
                self.transaction("3", 7, kind="Other"),
                self.transaction("8", 8, sku="ZERO-RATE"),
            ]
        )
        self.kiosk(
            1,
            [
                self.component("4") | {"component_type": "NET_PRODUCT_SALES", "fee_base": "0"},
                self.component("5", sku="GAP")
                | {"component_type": "NET_PRODUCT_SALES", "fee_base": "0"},
                self.component("6", sku="UNASSIGNED")
                | {"component_type": "NET_PRODUCT_SALES", "fee_base": "6"},
                self.component("7"),
                self.component("9", sku="ZERO-RATE")
                | {"component_type": "NET_PRODUCT_SALES", "fee_base": "9"},
            ],
            activity_date=self.recent_activity_date(),
        )
        operator = self.operator()
        for user, applicable_count, other_count in (
            (operator, "8", "3"),
            (self.member(company), "6", "3"),
        ):
            applicable = self.assert_matches_view(user, p_fee_applicable=True)
            other = self.assert_matches_view(user, p_fee_applicable=False)
            self.assertEqual(applicable["total_count"], applicable_count)
            self.assertEqual(other["total_count"], other_count)
        applicable_rows = cast(
            list[dict[str, object]], self.page(operator, p_fee_applicable=True)["rows"]
        )
        self.assertEqual(
            {row["resolution_status"] for row in applicable_rows},
            {"APPLIED", "MISSING_FEE", "MISSING_OWNERSHIP"},
        )
        self.assertEqual(sum(row["fee_base"] == "0" for row in applicable_rows), 4)
        zero_rates = [row for row in applicable_rows if row["sku"] == "ZERO-RATE"]
        self.assertEqual(len(zero_rates), 2)
        for row in zero_rates:
            self.assertEqual(Decimal(cast(str, row["fee_rate_percent"])), 0)
            self.assertEqual(Decimal(cast(str, row["fee_amount"])), 0)

    def test_fee_type_filter_is_source_specific_without_changing_financial_values(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        settlement_rows = [
            self.transaction("10") | {"component_type": "NET_PRODUCT_SALES"},
            self.transaction("20", 4, description="Shipping") | {"component_type": "PRODUCT_SALES"},
            self.transaction("-30", 5, kind="Refund"),
        ]
        kiosk_rows = [
            self.component("40") | {"component_type": "PRODUCT_SALES", "fee_base": "40"},
            self.component("50") | {"component_type": "NET_PRODUCT_SALES"},
            self.component("60") | {"fee_base": "60"},
        ]
        self.settlement(settlement_rows)
        self.kiosk(1, kiosk_rows, activity_date=self.recent_activity_date())
        # These deliberate inconsistencies are accepted by the storage schema.
        # Filtering uses TYPE; returned financial values still use source fields.
        applicable_ids = {row["id"] for row in [*settlement_rows[1:], kiosk_rows[1]]}
        all_ids = {row["id"] for row in [*settlement_rows, *kiosk_rows]}
        for user in (self.operator(), self.member(company), self.auth_user()):
            for direction in ("asc", "desc"):
                unfiltered = self.assert_matches_view(user, p_direction=direction, p_limit=1000)
                visible = cast(list[dict[str, object]], unfiltered["rows"])
                for applicable in (True, False):
                    selected_ids = applicable_ids if applicable else all_ids - applicable_ids
                    expected = [row for row in visible if row["source_row_id"] in selected_ids]
                    selected = self.page(
                        user, p_direction=direction, p_fee_applicable=applicable, p_limit=1000
                    )
                    self.assertEqual(selected["rows"], expected)
                    self.assertEqual(selected["total_count"], str(len(expected)))
                    count = self.as_user(
                        user,
                        "select public.transaction_count(p_fee_applicable => %s)",
                        (applicable,),
                    )
                    self.assertEqual(count, [(str(len(expected)),)])
                    for offset, row in enumerate(expected):
                        page = self.page(
                            user,
                            p_direction=direction,
                            p_fee_applicable=applicable,
                            p_limit=1,
                            p_offset=offset,
                        )
                        self.assertEqual(page["rows"], [row])
                        self.assertEqual(page["total_count"], str(len(expected)))

        member = self.member(company)
        for applicable, source, type_name in (
            (True, "SETTLEMENT", "NET_PRODUCT_SALES"),
            (True, "DATA_KIOSK", "PRODUCT_SALES"),
            (False, "SETTLEMENT", "PRODUCT_SALES"),
            (False, "DATA_KIOSK", "NET_PRODUCT_SALES"),
        ):
            page = self.page(
                member, p_fee_applicable=applicable, p_sources=[source], p_types=[type_name]
            )
            self.assertEqual(page, {"rows": [], "total_count": "0"})
            self.assertEqual(
                self.as_user(
                    member,
                    "select public.transaction_count(p_fee_applicable => %s, "
                    "p_sources => %s, p_types => %s)",
                    (applicable, [source], [type_name]),
                ),
                [("0",)],
            )

    def test_reported_amount_order_is_independent_of_fee_adjusted_amount(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "50")])
        self.assign("OTHER", company, rate="0")
        self.settlement([self.transaction("100", 3), self.transaction("90", 4, sku="OTHER")])
        member = self.member(company)
        page = self.assert_matches_view(member, p_order_by="amount", p_limit=1)
        rows = cast(list[dict[str, object]], page["rows"])
        self.assertEqual(rows[0]["source_amount"], "100")
        self.assertEqual(Decimal(cast(str, rows[0]["company_amount"])), Decimal("50"))
        self.assertEqual(page["total_count"], "2")

    def test_current_reprocessing_and_ownership_changes_are_immediately_reflected(self) -> None:
        company_a, sku = self.owner()
        company_b, _ = self.owner("OTHER")
        member_a, member_b, operator = (
            self.member(company_a),
            self.member(company_b),
            self.operator(),
        )
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, settlement = self.settlement([self.transaction("100")], acquisition_id=acquisition)
        _, kiosk = self.kiosk(1, [self.component("-10")])
        for user in (operator, member_a, member_b):
            self.assert_matches_view(user)
        self.settlement([self.transaction("200")], acquisition_id=acquisition, expected=settlement)
        self.kiosk(2, [self.component("-20")], expected=kiosk)
        new_terms = self.assign("SKU", company_b, rate="7", expected=terms)
        for user, count in ((operator, "3"), (member_a, "0"), (member_b, "2")):
            for include_count in (False, True):
                page = self.assert_matches_view(user, p_limit=1, p_include_count=include_count)
                self.assertEqual(page["total_count"], count if include_count else None)
        unassigned = self.assign("SKU", None, rate="7", expected=new_terms)
        for user, count in ((operator, "3"), (member_a, "0"), (member_b, "0")):
            for include_count in (False, True):
                page = self.assert_matches_view(user, p_limit=1, p_include_count=include_count)
                self.assertEqual(page["total_count"], count if include_count else None)
                for row in cast(list[dict[str, object]], page["rows"]):
                    if row["category"] == "SELBOX":
                        continue
                    self.assertEqual(row["terms_version_id"], unassigned)
                    self.assertEqual(row["sku_id"], sku)
                    self.assertEqual(row["resolution_status"], "MISSING_OWNERSHIP")
                    self.assertIsNone(row["company_amount"])
