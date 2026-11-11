"""Benchmark summary oracles preserve live authority and authenticated scope."""

import unittest
from datetime import date
from itertools import product
from typing import Any, cast

from services.db.supabase.benchmarks.aggregation_measurement import (
    Case,
    _canonical,  # pyright: ignore[reportPrivateUsage]
    _reference,  # pyright: ignore[reportPrivateUsage]
    summary_cases,
)
from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.local_database import require_row


class SummaryBenchmarkPeriodTests(unittest.TestCase):
    def test_periods_match_the_previous_utc_day_and_month_without_month_end_exceptions(
        self,
    ) -> None:
        for latest, day, start, end in (
            (date(2026, 11, 30), "2026-11-29", "2026-10-01", "2026-10-31"),
            (date(2026, 1, 1), "2025-12-31", "2025-12-01", "2025-12-31"),
            (date(2024, 3, 31), "2024-03-30", "2024-02-01", "2024-02-29"),
        ):
            with self.subTest(latest=latest):
                cases = {
                    case.name: case.arguments
                    for case in summary_cases(latest, "Amazon.com", "USD", include_skus=False)
                }
                self.assertEqual(cases["last_day"], {"p_date_from": day, "p_date_to": day})
                self.assertEqual(cases["last_month"], {"p_date_from": start, "p_date_to": end})


class AggregationBenchmarkReferenceTests(FinancialFixture):
    def test_reference_matches_totals_for_current_authority_roles_and_grouping(self) -> None:
        company, _ = self.financial_fixture()
        member, administrator = self.member(company), self.administrator()
        for (role, user, expected_count), grouped in product(
            (("member", member, 10), ("administrator", administrator, 17)), (False, True)
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
                self.assertEqual(excluded, 0)
                accounts = require_row(
                    self.connection.execute(
                        "select count(*) from public.live_company_components "
                        "where authoritative and category='SELBOX'"
                    ).fetchone()
                )[0]
                if role == "administrator":
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
