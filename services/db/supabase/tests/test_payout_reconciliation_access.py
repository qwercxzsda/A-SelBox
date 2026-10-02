"""Saved account controls retain their report scope and administrator-only access."""

from decimal import Decimal
from typing import LiteralString

from services.db.supabase.tests.payout_fixtures import prepare_payout, publish_payout
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutReconciliationAccessTests(SourceModelFixture):
    def test_views_keep_invoker_security_and_only_authenticated_read_grants(self) -> None:
        self.assertEqual(
            self.connection.execute(
                "select c.relname,'security_invoker=true'=any(c.reloptions),"
                "has_table_privilege('authenticated',c.oid,'SELECT'),"
                "has_table_privilege('anon',c.oid,'SELECT'),"
                "has_table_privilege('service_role',c.oid,'SELECT') "
                "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                "where n.nspname='public' and c.relname in "
                "('payout_reconciliation_totals') order by c.relname"
            ).fetchall(),
            [
                ("payout_reconciliation_totals", True, True, False, False),
            ],
        )

    def test_frozen_totals_stay_separate_per_report_and_do_not_follow_current_inputs(self) -> None:
        inputs = prepare_payout(self)
        other_company, _ = self.owner("OTHER")
        _, kiosk_version = self.kiosk(
            2,
            [
                self.component("-10"),
                self.component("-7", sku="OTHER"),
                self.component("-3") | {"currency": "EUR"},
            ],
            expected=inputs.kiosk_version,
        )
        report = publish_payout(self, inputs)
        other_report = publish_payout(self, inputs, company_id=other_company)
        operator = self.operator()
        query: LiteralString = (
            "select report_id::text,currency,settlement_category_amount,"
            "data_kiosk_settlement_control,data_kiosk_category_amount,difference,"
            "settlement_total,accounted_total,source_group_count "
            "from public.payout_reconciliation_totals order by report_id,currency"
        )
        expected = [
            (report_id, currency, sales, 0, costs, -costs, sales, sales, 1)
            for report_id in sorted((report, other_report))
            for currency, sales, costs in (("EUR", 0, -3), ("USD", 100, -17))
        ]
        self.assertEqual(self.as_user(operator, query), expected)
        for user in (self.member(inputs.company), self.member(other_company), self.auth_user()):
            self.assertEqual(self.as_user(user, query), [])
        self.kiosk(3, [self.component("-100")], expected=kiosk_version, digest="b")
        self.assertEqual(self.as_user(operator, query), expected)
        self.assertEqual(
            self.as_user(
                operator,
                "select currency,difference from public.financial_review_totals("
                "'2026-06-01','2026-07-01','DATA_KIOSK')",
            ),
            [("USD", Decimal(100))],
        )
        self.connection.execute("set constraints all immediate")
