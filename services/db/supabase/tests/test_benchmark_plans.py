"""Plan collection executes the installed RPC with the selected actor's privileges."""

from itertools import product

import psycopg

from services.db.supabase.benchmarks.plans import explain_rpc
from services.db.supabase.benchmarks.table_verification import discover_cases
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class SourcePageBenchmarkPlanTests(SourceModelFixture):
    def test_plans_call_the_real_actor_scoped_rpcs(self) -> None:
        company, _ = self.owner()
        self.finances([self.transaction("100")])
        admin, member = self.administrator(), self.member(company)
        self.connection.commit()
        for actor, granularity in product((admin, member), ("day", "week")):
            result = explain_rpc(
                self.connection,
                actor,
                "transaction_totals",
                {"p_granularity": granularity, "p_date_from": "2026-06-01"},
            )
            self.assertGreaterEqual(result["execution_ms"], 0)
            self.assertIn("Shared Hit Blocks", result["buffers"])
        for function in ("source_transaction_page", "source_transaction_count"):
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                explain_rpc(self.connection, member, function, {"p_dataset": "finances"})
            plan = explain_rpc(self.connection, admin, function, {"p_dataset": "finances"})
            self.assertEqual(len(plan["installed_definition_sha256"]), 64)

    def test_case_discovery_uses_actual_actor_scope_and_fixture_size(self) -> None:
        company, _ = self.owner()
        self.finances([self.transaction("100")])
        for actor, expected in (
            (self.administrator(), {"live", "finances"}),
            (self.member(company), {"live"}),
        ):
            cases = discover_cases(self.connection, actor)
            self.assertEqual({case.dataset.key for case in cases}, expected)
            self.assertFalse(any(case.expect_cap for case in cases))
