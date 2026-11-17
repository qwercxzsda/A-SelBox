"""Benchmark plans explain the installed normalized source-page query under RLS."""

from itertools import product

import psycopg

from services.db.supabase.benchmarks.plans import explain_rpc
from services.db.supabase.benchmarks.search_resolution import resolve_search_values
from services.db.supabase.benchmarks.table_verification import discover_cases
from services.db.supabase.tests.rpc_support import read_rpc_execution_settings
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class SourcePageBenchmarkPlanTests(SourceModelFixture):
    def planner_settings(self) -> tuple[object, ...]:
        with self.connection.transaction():
            return read_rpc_execution_settings(self.connection)

    def test_totals_plans_bind_daily_and_weekly_buckets_under_rls(self) -> None:
        company, _ = self.owner()
        self.finances([self.transaction("100")])
        self.kiosk(1, [self.component()])
        actors = (self.administrator(), self.member(company))
        self.connection.commit()
        caller_settings = self.planner_settings()
        for actor, granularity in product(actors, (None, "day", "week")):
            with self.subTest(actor=actor, granularity=granularity):
                plan = explain_rpc(
                    self.connection,
                    actor,
                    "transaction_totals",
                    {
                        "p_date_from": "2026-06-15",
                        "p_date_to": "2026-06-16",
                        "p_granularity": granularity,
                    },
                )
                self.assertEqual(plan["rpc"], "transaction_totals")
                self.assertEqual(
                    plan["planner_settings"],
                    {
                        "plan_cache_mode": "force_custom_plan",
                        "enable_sort": "off",
                        "enable_presorted_aggregate": "off",
                    },
                )
                self.assertEqual(self.planner_settings(), caller_settings)
                fact_groups = next(
                    node
                    for node in plan["aggregates"]
                    if node.get("Subplan Name") == "CTE fact_groups"
                )
                self.assertEqual(fact_groups["Strategy"], "Hashed")
                scanned = {
                    item.get("Relation Name")
                    for item in [*plan["index_nodes"], *plan["relation_scans"]]
                }
                self.assertIn("finances_transaction_components", scanned)
                self.assertIn("data_kiosk_day_components", scanned)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            explain_rpc(
                self.connection,
                actors[0],
                "transaction_totals",
                {"p_date_from": "2026-06-15", "p_granularity": "invalid"},
            )
        self.assertEqual(self.planner_settings(), caller_settings)

    def test_installed_source_pages_explain_for_both_datasets_and_orders(self) -> None:
        self.owner()
        self.finances([self.transaction("100"), self.transaction("20", 4)])
        self.kiosk(1, [self.component()])
        actor = self.administrator()
        for dataset, order in product(("finances", "data_kiosk"), ("date", "amount")):
            with self.subTest(actor=actor, dataset=dataset, order=order):
                response = self.as_user(
                    actor,
                    "select public.source_transaction_page(%s,p_order_by=>%s,"
                    "p_direction=>'desc',p_limit=>1,p_include_count=>false)",
                    (dataset, order),
                )
                self.assertIsInstance(response[0][0], dict)
                self.connection.commit()
                plan = explain_rpc(
                    self.connection,
                    actor,
                    "source_transaction_page",
                    {
                        "p_dataset": dataset,
                        "p_order_by": order,
                        "p_direction": "desc",
                        "p_limit": 1,
                        "p_include_count": False,
                    },
                )
                self.assertEqual(plan["rpc"], "source_transaction_page")
                self.assertEqual(len(plan["installed_definition_sha256"]), 64)
                scanned = {
                    item.get("Relation Name")
                    for item in [*plan["index_nodes"], *plan["relation_scans"]]
                }
                self.assertIn(
                    "finances_transaction_components"
                    if dataset == "finances"
                    else "data_kiosk_day_components",
                    scanned,
                )

    def test_member_plans_cover_transactions_and_reject_raw_source_rpcs(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        self.finances([self.transaction("100")])
        self.kiosk(1, [self.component()])
        self.connection.commit()
        for order in ("date", "amount"):
            plan = explain_rpc(
                self.connection,
                member,
                "transaction_page",
                {"p_order_by": order, "p_limit": 1, "p_include_count": False},
            )
            self.assertEqual(plan["rpc"], "transaction_page")
            self.assertTrue(plan["index_nodes"] or plan["relation_scans"])
        for dataset, function in product(
            ("finances", "data_kiosk"), ("source_transaction_page", "source_transaction_count")
        ):
            with (
                self.subTest(dataset=dataset, function=function),
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
            ):
                explain_rpc(self.connection, member, function, {"p_dataset": dataset})

    def test_search_benchmarks_select_permitted_datasets_and_authoritative_types(self) -> None:
        company, _ = self.owner()
        self.finances([self.transaction("100")])
        self.kiosk(1, [self.component()])
        for actor, expected in (
            (self.administrator(), {"live", "finances", "data_kiosk"}),
            (self.member(company), {"live"}),
        ):
            with self.subTest(datasets=expected), self.connection.transaction(force_rollback=True):
                self.connection.execute(
                    "select set_config('request.jwt.claim.sub',%s,true)", (actor,)
                )
                cases = discover_cases(self.connection, actor)
                self.assertEqual({case.dataset.key for case in cases}, expected)
                self.assertEqual(
                    resolve_search_values(self.connection, "NET_PRODUCT_SALES", "live")[
                        "p_search_types"
                    ],
                    [],
                )
                self.assertEqual(
                    resolve_search_values(self.connection, "NET_PRODUCT_SALES", "data_kiosk")[
                        "p_search_types"
                    ],
                    ["NET_PRODUCT_SALES"] if "data_kiosk" in expected else [],
                )
