"""Marketplace filters preserve global date order, offsets, counts, and source access."""

from itertools import product
from typing import cast

from services.db.supabase.tests import test_date_ordering as date_fixture
from services.db.supabase.tests import test_source_transaction_page as source_fixture
from services.db.supabase.tests import test_transaction_page as live_fixture
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id

_MARKETS = ("Amazon.com", "Amazon.ca")
_DAYS = ("2026-06-14", "2026-06-15", "2026-06-16")


class MarketplaceOrderingTests(SourceModelFixture):
    live_page = live_fixture.TransactionPageTests.page
    source_page = source_fixture.SourceTransactionPageTests.page
    expected_live = live_fixture.TransactionPageTests.expected
    expected_source = source_fixture.SourceTransactionPageTests.expected
    page = date_fixture.DateOrderingTests.page
    expected = date_fixture.DateOrderingTests.expected

    def publish_marketplaces(
        self,
        version: str,
        settlement_previous: str | None = None,
        day_previous: dict[tuple[str, str], str] | None = None,
    ) -> tuple[str, dict[tuple[str, str], str]]:
        settlement_rows: list[dict[str, object]] = []
        days: list[dict[str, object]] = []
        current: dict[tuple[str, str], str] = {}
        for marketplace, day in product(_MARKETS, _DAYS):
            for category, sku in (
                ("SETTLEMENT", "SKU"),
                ("DATA_KIOSK", "OTHER"),
                ("SELBOX", None),
            ):
                row = self.transaction(
                    "10", len(settlement_rows) + 3, activity_date=day, category=category
                ) | {"marketplace_name": marketplace, "sku": sku}
                if category == "SELBOX":
                    row["family"] = None
                settlement_rows.append(row)
            components = [
                self.component("1"),
                self.component("2", sku="OTHER", category="SETTLEMENT"),
                self.component("3", category="ANALYSIS_ONLY"),
                self.component("4", category="SELBOX") | {"sku": None},
            ]
            # Equal IDs across sources require the Source tie-breaker as well as date/ID.
            components[0]["id"] = settlement_rows[-3]["id"]
            key = marketplace, day
            current[key] = new_id()
            days.append(
                {
                    "id": current[key],
                    "marketplace_name": marketplace,
                    "activity_date": day,
                    "expected_current_version_id": None
                    if day_previous is None
                    else day_previous[key],
                    "content_sha256": "a" * 64,
                    "transactions": components,
                }
            )
        _, settlement = self.settlement(
            settlement_rows, version=version, expected=settlement_previous
        )
        for marketplace in _MARKETS:
            self.call(
                "publish_data_kiosk_preprocess",
                {
                    "id": new_id(),
                    "acquisition_id": self.kiosk_acquisition(
                        1 if day_previous is None else 2, start=_DAYS[0], end=_DAYS[-1]
                    ),
                    "preprocess_version": version,
                    "dataset_key": "economics",
                    "days": [day for day in days if day["marketplace_name"] == marketplace],
                },
            )
        return settlement, current

    def marketplace_fixture(self) -> tuple[str, str]:
        company, sku = self.owner()
        self.owner("OTHER")
        self.fee(sku, [("2026-01-01", None, "5")])
        settlement, days = self.publish_marketplaces("old")
        self.publish_marketplaces("current", settlement, days)
        self.connection.execute("set constraints all immediate")
        return self.operator(), self.member(company)

    def count(self, user: str, dataset: str, marketplaces: list[str] | None) -> str:
        if dataset == "live":
            rows = self.as_user(
                user, "select public.transaction_count(p_marketplaces=>%s::text[])", (marketplaces,)
            )
        else:
            rows = self.as_user(
                user,
                "select public.source_transaction_count(%s,p_marketplaces=>%s::text[])",
                (dataset, marketplaces),
            )
        return cast(str, rows[0][0])

    def test_populated_marketplaces_keep_ordered_pages_counts_and_raw_history(self) -> None:
        operator, member = self.marketplace_fixture()
        selections: tuple[list[str] | None, ...] = (
            None,
            [],
            [_MARKETS[0]],
            [_MARKETS[1]],
            list(_MARKETS),
            [*_MARKETS, _MARKETS[0]],
        )
        for user, dataset in product((operator, member), ("live", "settlement", "data_kiosk")):
            unfiltered = self.expected(user, dataset, p_limit=1000)
            rows = cast(list[dict[str, object]], unfiltered["rows"])
            self.assertEqual({row["marketplace_name"] for row in rows}, set(_MARKETS))
            if dataset != "live":
                self.assertEqual(
                    {row["preprocess_version"] for row in rows},
                    {"old", "current"} if user == operator else {"current"},
                )
                self.assertEqual(any(row["category"] == "SELBOX" for row in rows), user == operator)
            for selection in selections:
                count = self.count(user, dataset, selection)
                reference = self.expected(user, dataset, p_marketplaces=selection, p_limit=1000)
                self.assertEqual(count, reference["total_count"])
                for direction, offset in product(("asc", "desc"), (0, 1, 5, 100)):
                    options = {
                        "p_marketplaces": selection,
                        "p_direction": direction,
                        "p_limit": 3,
                        "p_offset": offset,
                        "p_include_count": offset != 1,
                    }
                    with self.subTest(
                        user=user,
                        dataset=dataset,
                        selection=selection,
                        direction=direction,
                        offset=offset,
                    ):
                        page = self.page(user, dataset, **options)
                        self.assertEqual(page, self.expected(user, dataset, **options))
                        self.assertEqual(page["total_count"], count if offset != 1 else None)

    def test_singleton_arrays_with_nonstandard_lower_bounds_keep_marketplace_selection(
        self,
    ) -> None:
        users = self.marketplace_fixture()
        for user, dataset, direction, lower in product(
            users, ("live", "settlement", "data_kiosk"), ("asc", "desc"), (-3, 0, 7)
        ):
            arguments: tuple[object, ...] = (_MARKETS[1], lower, direction)
            filters = (
                "p_marketplaces=>array_fill(%s::text,array[1],array[%s::integer]),"
                "p_direction=>%s,p_limit=>3,p_offset=>1,p_include_count=>true"
            )
            if dataset == "live":
                query = "select public.transaction_page(" + filters + ")"
            else:
                query = "select public.source_transaction_page(%s," + filters + ")"
                arguments = (dataset, *arguments)
            with self.subTest(user=user, dataset=dataset, direction=direction, lower=lower):
                actual = self.as_user(user, query, arguments)[0][0]
                self.assertEqual(
                    actual,
                    self.expected(
                        user,
                        dataset,
                        p_marketplaces=[_MARKETS[1]],
                        p_direction=direction,
                        p_limit=3,
                        p_offset=1,
                    ),
                )

    def test_marketplace_candidate_budget_preserves_results_and_complete_counts(self) -> None:
        users = self.marketplace_fixture()
        repeated_markets = list(_MARKETS) * 2048
        scenarios: tuple[tuple[str, dict[str, object]], ...] = (
            # Two selected markets permit 2,048 candidates each at the boundary.
            ("exact_offset_budget", {"p_offset": 2045, "p_limit": 3}),
            ("above_offset_budget", {"p_offset": 2046, "p_limit": 3}),
            # Raw array cardinality bounds work; DISTINCT prevents duplicate output.
            ("exact_duplicate_budget", {"p_marketplaces": repeated_markets, "p_limit": 1}),
            (
                "above_duplicate_budget",
                {"p_marketplaces": [*repeated_markets, _MARKETS[0]], "p_limit": 1},
            ),
            (
                "maximum_offset",
                {
                    "p_marketplaces": repeated_markets,
                    "p_limit": 3,
                    "p_offset": 9007199254740991,
                },
            ),
            ("amount_ordering", {"p_order_by": "amount", "p_limit": 1}),
        )
        for user, dataset in product(users, ("live", "settlement", "data_kiosk")):
            count = self.count(user, dataset, list(_MARKETS))
            self.assertGreater(int(count), 0)
            for direction, (scenario, selection) in product(("asc", "desc"), scenarios):
                options = {
                    "p_marketplaces": list(_MARKETS),
                    "p_direction": direction,
                    "p_include_count": True,
                    **selection,
                }
                with self.subTest(
                    user=user, dataset=dataset, direction=direction, scenario=scenario
                ):
                    page = self.page(user, dataset, **options)
                    self.assertEqual(page, self.expected(user, dataset, **options))
                    self.assertEqual(page["total_count"], count)
                    if scenario in ("exact_offset_budget", "above_offset_budget", "maximum_offset"):
                        self.assertEqual(page["rows"], [])
