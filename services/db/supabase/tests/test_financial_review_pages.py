"""Financial review pages retain exact ordering, period scope and administrator access."""

from typing import LiteralString
from uuid import uuid7

import psycopg

from services.db.supabase.tests.reference_fixture import ReferenceFixture


class FinancialReviewPageTests(ReferenceFixture):
    def set_actor(self, role: str) -> None:
        user = uuid7()
        self.connection.execute("insert into auth.users(id) values(%s)", (user,))
        if role != "unassigned":
            self.connection.execute(
                "update public.app_accounts set access_role=%s,company_id=%s where user_id=%s",
                (role, self.company if role == "member" else None, user),
            )
        self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(user),))
        self.connection.execute("set local role authenticated")

    def test_ordered_review_and_month_pages_agree_with_the_complete_views(self) -> None:
        self.assign_sku("A", self.company)
        self.finance(
            [
                {"route": "SKU", "sku": "A", "amount": 3, "date": "2026-02-01"},
                {"route": "SKU", "sku": "A", "amount": 5, "date": "2026-02-01"},
                {"route": "SKU", "sku": "A", "amount": 1, "date": "2026-01-31"},
                {"route": "SKU", "sku": "MISSING", "amount": 2, "date": "2026-01-31"},
                {"route": "SELBOX", "amount": -2, "date": "2026-01-31"},
            ]
        )
        self.set_actor("administrator")
        for outcome, offset in (("COMPANY", 0), ("COMPANY", 2), ("SELBOX", 0), ("DIFFERENCE", 0)):
            with self.subTest(outcome=outcome, offset=offset):
                expected = self.connection.execute(
                    "select * from public.financial_outcomes where outcome=%s "
                    "order by posted_date desc,source_row_id,reason,marketplace_name "
                    "limit 1 offset %s",
                    (outcome, offset),
                ).fetchall()
                self.assertEqual(
                    self.connection.execute(
                        "select * from public.financial_outcome_page(%s,null,null,1,%s)",
                        (outcome, offset),
                    ).fetchall(),
                    expected,
                )
        self.assertEqual(
            self.one(
                "select count(*) from public.financial_outcome_page('COMPANY','2026-01-01',%s)",
                ("Amazon.com",),
            ),
            1,
        )
        self.assertEqual(
            self.one(
                "select count(*) from public.financial_outcome_page('COMPANY','2026-01-01',%s)",
                ("Amazon.ca",),
            ),
            0,
        )
        self.assertEqual(
            self.connection.execute(
                "select * from public.financial_review_month_page('2026-01-01','Amazon.com')"
            ).fetchall(),
            self.connection.execute(
                "select * from public.financial_review_monthly where month='2026-01-01'"
            ).fetchall(),
        )

    def test_both_review_pages_reject_company_and_unassigned_accounts(self) -> None:
        queries: tuple[LiteralString, ...] = (
            "select * from public.financial_outcome_page('DIFFERENCE')",
            "select * from public.financial_review_month_page()",
        )
        for role in ("member", "unassigned"):
            self.set_actor(role)
            for query in queries:
                with (
                    self.subTest(role=role, query=query),
                    self.assertRaises(psycopg.errors.InsufficientPrivilege),
                    self.connection.transaction(),
                ):
                    self.connection.execute(query).fetchall()
            self.connection.execute("reset role")
