"""Benchmark plans explain the installed normalized source-page query under RLS."""

from itertools import product

from services.db.supabase.benchmarks.plans import explain_rpc
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class SourcePageBenchmarkPlanTests(SourceModelFixture):
    def test_installed_source_pages_explain_for_both_datasets_and_orders(self) -> None:
        company, _ = self.owner()
        self.finances([self.transaction("100"), self.transaction("20", 4)])
        self.kiosk(1, [self.component()])
        actors = (self.administrator(), self.member(company))
        for actor, dataset, order in product(
            actors, ("finances", "data_kiosk"), ("date", "amount")
        ):
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
                    else "data_kiosk_transactions",
                    scanned,
                )
