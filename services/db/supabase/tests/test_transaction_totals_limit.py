"""Complete aggregate responses reject excess groups without truncation."""

import json
from typing import cast

import psycopg

from services.db.supabase.tests.rpc_support import read_rpc_execution_settings
from services.db.supabase.tests.transaction_totals_fixture import TransactionTotalsFixture


class TransactionTotalsLimitTests(TransactionTotalsFixture):
    def test_limit_counts_final_groups_and_rejects_overflow_with_structured_detail(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        _, previous = self.kiosk(
            1,
            [self.component("0") | {"component_type": f"CAP-{number}"} for number in range(100000)],
        )
        complete = self.read_totals(member, p_group_by_type=True)
        self.assertEqual(complete["group_count"], "100000")
        self.assertEqual(len(cast(list[object], complete["rows"])), 100000)
        self.kiosk(
            2,
            [self.component("0") | {"component_type": f"CAP-{number}"} for number in range(100001)],
            expected=previous,
        )
        caller_settings = read_rpc_execution_settings(self.connection)
        for mode in ({"p_group_by_type": True}, {"p_granularity": "day"}):
            with (
                self.subTest(mode=mode),
                self.assertRaises(psycopg.errors.InvalidParameterValue) as raised,
            ):
                self.read_totals(member, **mode)
            self.assertEqual(
                json.loads(raised.exception.diag.message_detail or "{}"),
                {"code": "TRANSACTION_TOTAL_GROUP_LIMIT", "limit": 100000},
            )
            self.assertEqual(
                raised.exception.diag.message_primary,
                "Transaction totals exceed 100000 groups; "
                "select a shorter date range or narrower filters",
            )
            self.assertEqual(read_rpc_execution_settings(self.connection), caller_settings)
        # The same number of facts is valid when it produces one aggregate group.
        aggregate = self.read_totals(member)
        self.assertEqual(aggregate["group_count"], "1")
        self.assertEqual(cast(list[dict[str, str]], aggregate["rows"])[0]["row_count"], "100001")
