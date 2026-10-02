"""Monthly publication, authoritative totals, and caller-bound payout access."""

from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from typing import cast

import psycopg
from psycopg import sql

from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    generate_payout_reports,
    publish_report,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class MonthlyPayoutGenerationTests(SourceModelFixture):
    def prepared_company(self) -> str:
        company, identity = self.owner()
        self.fee(identity, [("2026-01-01", None, "5")])
        self.settlement([self.transaction("100")])
        self.kiosk(1, [self.component("-10")])
        fill_payout_kiosk_month(self)
        return company

    def generate(self, company: str, month: date = date(2026, 6, 1)) -> str:
        rows = generate_payout_reports(self, company, month)
        self.assertEqual(len(rows), 1)
        return rows[0][0]

    def test_generation_freezes_month_and_includes_data_kiosk_costs_once(self) -> None:
        company = self.prepared_company()
        report = self.generate(company)
        self.assertEqual(
            self.connection.execute(
                "select start_date,end_date,source_amount,fee_amount,company_amount,"
                "component_count "
                "from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (date(2026, 6, 1), date(2026, 6, 30), Decimal(90), Decimal(-5), Decimal(85), 2),
        )
        self.assertEqual(
            self.connection.execute(
                "select source,authoritative,source_amount,fee_amount,company_amount "
                "from public.company_payout_report_components where report_id=%s order by source",
                (report,),
            ).fetchall(),
            [
                ("DATA_KIOSK", True, Decimal(-10), Decimal(0), Decimal(-10)),
                ("SETTLEMENT", True, Decimal(100), Decimal(-5), Decimal(95)),
            ],
        )
        self.connection.execute("set constraints all immediate")

    def test_incompatible_required_kiosk_day_blocks_monthly_report(self) -> None:
        company = self.prepared_company()
        selected = self.connection.execute(
            "select current_version_id::text from private.data_kiosk_days "
            "where seller_namespace=%s and activity_date='2026-06-16'",
            (self.seller,),
        ).fetchone()
        if selected is None:
            self.fail("Expected complete June Kiosk coverage.")
        self.kiosk(
            2,
            [self.component("-20")],
            expected=selected[0],
            version="v1",
            activity_date="2026-06-16",
        )
        with self.assertRaisesRegex(
            psycopg.errors.CheckViolation, "preprocessing versions|incompatible.*Data Kiosk"
        ):
            self.generate(company)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )

    def test_operator_cannot_inject_a_temporary_table_trigger_into_publication(self) -> None:
        company = self.prepared_company()
        operator = self.operator()
        with self.connection.transaction():
            self.connection.execute(
                "select set_config('request.jwt.claim.sub',%s,true)", (operator,)
            )
            self.connection.execute("set local role authenticated")
            self.connection.execute(
                "create temporary table payout_resolved_components as "
                "select * from private.resolve_company_components('{}','{}','{}')"
            )
            self.connection.execute(
                "create temporary table payout_reconciliation as "
                "select * from private.resolve_source_reconciliation('{}','{}')"
            )
            self.connection.execute(
                "create function pg_temp.payout_hijack() returns trigger language plpgsql as $$ "
                "begin raise exception 'Untrusted payout trigger executed'; "
                "end; $$"
            )
            for table in ("payout_resolved_components", "payout_reconciliation"):
                self.connection.execute(
                    sql.SQL(
                        "create trigger payout_hijack before insert or truncate "
                        "on pg_temp.{} for each statement execute function pg_temp.payout_hijack()"
                    ).format(sql.Identifier(table))
                )
            self.connection.execute("reset role")
        self.generate(company)
        for table in ("payout_resolved_components", "payout_reconciliation"):
            with self.subTest(table=table):
                self.assertEqual(
                    self.connection.execute(
                        "select count(*) from pg_trigger where tgrelid=%s::regclass "
                        "and tgname='payout_hijack'",
                        ("pg_temp." + table,),
                    ).fetchone(),
                    (0,),
                )
        self.connection.execute("set constraints all immediate")

    def test_other_company_missing_fee_does_not_block_own_report(self) -> None:
        company, identity = self.owner()
        self.owner("OTHER")
        self.fee(identity, [("2026-01-01", None, "5")])
        self.settlement([self.transaction("100"), self.transaction("200", 4, sku="OTHER")])
        fill_payout_kiosk_month(self)
        report = self.generate(company)
        self.assertEqual(
            self.connection.execute(
                "select company_amount from public.company_payout_reports where id=%s", (report,)
            ).fetchone(),
            (Decimal(95),),
        )
        self.connection.execute("set constraints all immediate")

    def test_controls_reconcile_without_allocating_selbox_or_difference_to_company(self) -> None:
        company, identity = self.owner()
        self.fee(identity, [("2026-01-01", None, "5")])
        self.settlement(
            [
                self.transaction("100"),
                self.transaction("-3", 4, category="SELBOX") | {"sku": None, "family": None},
                self.transaction("-12", 5, kind="ServiceFee", category="DATA_KIOSK")
                | {"sku": None},
                self.transaction("-2", 6, kind="ServiceFee", category="DATA_KIOSK")
                | {"sku": None, "marketplace_name": None},
            ]
        )
        self.kiosk(1, [self.component("-10"), self.component("100", category="SETTLEMENT")])
        fill_payout_kiosk_month(self)
        operator, member = self.operator(), self.member(company)
        report = self.generate(company)
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount,reconciliation_count "
                "from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(90), Decimal(-5), Decimal(85), 2),
        )
        self.assertEqual(
            self.as_user(
                operator,
                "select marketplace_name,settlement_category_amount,selbox_category_amount,"
                "data_kiosk_settlement_control,"
                "data_kiosk_category_amount,difference,settlement_total,accounted_total "
                "from public.payout_report_reconciliation where report_id=%s "
                "order by marketplace_name nulls first",
                (report,),
            ),
            [
                (
                    None,
                    Decimal(0),
                    Decimal(0),
                    Decimal(-2),
                    Decimal(0),
                    Decimal(-2),
                    Decimal(-2),
                    Decimal(-2),
                ),
                (
                    "Amazon.com",
                    Decimal(100),
                    Decimal(-3),
                    Decimal(-12),
                    Decimal(-10),
                    Decimal(-2),
                    Decimal(85),
                    Decimal(85),
                ),
            ],
        )
        self.assertEqual(
            self.as_user(member, "select * from public.payout_report_reconciliation"), []
        )
        self.assertEqual(
            self.as_user(member, "select * from private.payout_report_reconciliation"), []
        )
        self.connection.execute("set constraints all immediate")

    def test_saved_reconciliation_must_match_the_frozen_source_versions(self) -> None:
        company = self.prepared_company()
        report = self.generate(company)
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "reconciliation"),
            self.connection.transaction(),
        ):
            self.connection.execute(
                "alter table private.payout_report_reconciliation disable trigger immutable"
            )
            self.connection.execute(
                "update private.payout_report_reconciliation "
                "set settlement_category_amount=settlement_category_amount+1,"
                "settlement_total=settlement_total+1,accounted_total=accounted_total+1 "
                "where report_id=%s",
                (report,),
            )
            self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all immediate")

    def test_deferred_integrity_runs_for_internal_generation_without_a_login(self) -> None:
        company = self.prepared_company()
        self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all deferred")
        with self.connection.transaction():
            self.connection.execute(
                "select * from private.generate_company_payout_reports(%s,'2026-06-01')", (company,)
            ).fetchall()
            self.connection.execute("set constraints all immediate")

    def test_company_with_only_data_kiosk_costs_can_generate(self) -> None:
        company, _ = self.owner()
        self.kiosk(1, [self.component("-10")])
        fill_payout_kiosk_month(self)
        report = self.generate(company)
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount from public.company_payout_reports "
                "where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(-10), Decimal(0), Decimal(-10)),
        )
        self.assertEqual(
            self.connection.execute(
                "select settlement_total,data_kiosk_category_amount,difference,accounted_total "
                "from private.payout_report_reconciliation where report_id=%s",
                (report,),
            ).fetchone(),
            (Decimal(0), Decimal(-10), Decimal(10), Decimal(0)),
        )
        self.connection.execute("set constraints all immediate")

    def test_no_application_user_can_generate_and_own_frozen_rows_are_visible(self) -> None:
        company = self.prepared_company()
        own_member = self.member(company)
        other_company, _ = self.owner("OTHER")
        other_member = self.member(other_company)
        report = self.generate(company)
        for user in (self.operator(), own_member, other_member, self.auth_user()):
            with self.subTest(user=user), self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(
                    user,
                    "select * from private.generate_company_payout_reports(%s,'2026-06-01')",
                    (company,),
                )
        self.assertEqual(
            self.as_user(own_member, "select id::text from public.company_payout_reports"),
            [(report,)],
        )
        self.assertEqual(
            self.as_user(other_member, "select * from public.company_payout_reports"), []
        )
        self.assertEqual(
            self.as_user(other_member, "select * from public.company_payout_report_components"), []
        )

    def test_generation_requires_exact_mature_month_and_allows_empty_history(self) -> None:
        company = self.prepared_company()
        mature_cutoff_date = self.mature_cutoff_date()
        for month in (date(2026, 6, 15), mature_cutoff_date.replace(day=1), date(2030, 1, 1)):
            with self.subTest(month=month), self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.generate(company, month)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )
        report = self.generate(company, date(2025, 1, 1))
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount from public.company_payout_reports "
                "where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(0), Decimal(0), Decimal(0)),
        )

    def test_month_end_equal_to_mature_cutoff_date_is_ineligible_until_the_following_day(
        self,
    ) -> None:
        company = self.prepared_company()
        self.set_mature_cutoff_date(date(2026, 6, 30))
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.generate(company)
        self.set_mature_cutoff_date(date(2026, 7, 1))
        self.generate(company)
        self.connection.execute("set constraints all immediate")

    def test_private_publisher_enforces_month_and_mature_cutoff_date(self) -> None:
        company = self.prepared_company()
        mature_cutoff_date = self.mature_cutoff_date()
        current_month = mature_cutoff_date.replace(day=1)
        current_month_end = current_month.replace(
            day=monthrange(current_month.year, current_month.month)[1]
        )
        for start, end in (
            ("2026-06-15", "2026-06-15"),
            (current_month.isoformat(), current_month_end.isoformat()),
        ):
            with (
                self.subTest(start=start),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
                self.connection.transaction(),
            ):
                publish_report(self, company, start_date=start, end_date=end)

    def test_policy_uses_database_mature_cutoff_date(self) -> None:
        company, _ = self.owner()
        policy = cast(
            dict[str, object],
            self.as_user(self.member(company), "select public.payout_report_policy()")[0][0],
        )
        mature_cutoff_date = self.mature_cutoff_date()
        self.assertEqual(policy["mature_cutoff_date"], mature_cutoff_date.isoformat())
        self.assertEqual(policy["mature_cutoff_months"], 2)
        self.assertEqual(
            policy["latest_month"],
            (mature_cutoff_date.replace(day=1) - timedelta(days=1)).replace(day=1).isoformat(),
        )
        self.connection.execute("set constraints all immediate")
