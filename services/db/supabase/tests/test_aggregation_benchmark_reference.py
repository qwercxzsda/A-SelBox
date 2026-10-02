"""Benchmark summary oracles preserve live authority and authenticated scope."""

from datetime import date
from itertools import product
from typing import Any, cast

from services.db.supabase.benchmarks.aggregation_measurement import (
    Case,
    _canonical,  # pyright: ignore[reportPrivateUsage]
    _reference,  # pyright: ignore[reportPrivateUsage]
)
from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.local_database import require_row


class AggregationBenchmarkReferenceTests(FinancialFixture):
    def test_reference_matches_totals_for_current_authority_roles_and_grouping(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
        company, _ = self.financial_fixture()
        member, operator = self.member(company), self.operator()
        for (role, user, expected_count), grouped in product(
            (("member", member, 10), ("operator", operator, 20)), (False, True)
        ):
            with self.subTest(role=role, grouped=grouped), self.connection.transaction():
                self.connection.execute(
                    "select set_config('request.jwt.claim.sub',%s,true)", (user,)
                )
                self.connection.execute("set local role authenticated")
                excluded = require_row(
                    self.connection.execute(
                        "select count(*) from public.live_company_components "
                        "where not authoritative"
                    ).fetchone()
                )[0]
                self.assertGreater(excluded, 0)
                accounts = require_row(
                    self.connection.execute(
                        "select count(*) from public.live_company_components "
                        "where authoritative and category='SELBOX'"
                    ).fetchone()
                )[0]
                if role == "operator":
                    self.assertGreater(accounts, 0)
                else:
                    self.assertEqual(accounts, 0)
                case = Case(
                    "authority_regression",
                    "transaction_totals",
                    {
                        "p_date_from": "2026-06-01",
                        "p_date_to": "2026-07-31",
                        "p_group_by_type": grouped,
                    },
                )
                reference = _canonical(_reference(self.connection, case), case)
                result = cast(
                    dict[str, Any],
                    require_row(
                        self.connection.execute(
                            "select public.transaction_totals("
                            "p_date_from=>'2026-06-01',p_date_to=>'2026-07-31',"
                            "p_group_by_type=>%s)",
                            (grouped,),
                        ).fetchone()
                    )[0],
                )
                self.assertIsNone(result["next_offset"])
                self.assertEqual(reference, _canonical(result["rows"], case))
                self.assertEqual(sum(row[-2] for row in reference), expected_count)
                self.connection.execute("reset role")
