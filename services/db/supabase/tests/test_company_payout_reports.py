"""Frozen payout economics, operator access, and complete evidence validation."""

from decimal import Decimal

import psycopg
from psycopg import sql

from services.db.supabase.tests.payout_fixtures import fill_payout_kiosk_month, payout_snapshot
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class CompanyPayoutReportTests(SourceModelFixture):
    def report(self, company: str, settlements: list[str], **scope: object) -> str:
        if scope.get("marketplace_names"):
            fill_payout_kiosk_month(self)
        return self.call(
            "publish_company_payout_report",
            {
                "id": new_id(),
                "company_id": company,
                "seller_namespace": self.seller,
                "currency": "USD",
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "preprocess_version": "v0",
                "settlement_ids": settlements,
                "marketplace_names": [],
                "dataset_key": "economics",
                "report_name": "June entitlement",
                "change_reason": "Save exact source and terms inputs",
                **scope,
            },
        )

    def reassign(self, identity: str, company: str | None) -> str:
        row = self.connection.execute(
            "select sku,current_terms_version_id from public.seller_skus where id=%s",
            (identity,),
        ).fetchone()
        if row is None:
            raise AssertionError("Expected SKU identity.")
        return self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "seller_sku_id": identity,
                "seller_namespace": self.seller,
                "sku": row[0],
                "company_id": company,
                "expected_current_version_id": str(row[1]),
                "change_reason": "Change current ownership",
                "periods": [],
            },
        )

    def test_report_freezes_all_three_inputs_and_noncommission_provenance(self) -> None:
        company, identity = self.owner()
        terms = self.fee(identity, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        settlement, settlement_version = self.settlement(
            [self.transaction("100")], acquisition_id=acquisition
        )
        _, kiosk_version = self.kiosk(1, [self.component()])
        report = self.report(company, [settlement], marketplace_names=["Amazon.com"])
        before = payout_snapshot(self, report)
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount "
                "from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(90), Decimal(-5), Decimal(85)),
        )
        self.assertEqual(
            self.connection.execute(
                "select terms_version_id::text,fee_period_id,fee_rate_percent,fee_amount "
                "from public.company_payout_report_components "
                "where report_id=%s and source='DATA_KIOSK'",
                (report,),
            ).fetchone(),
            (terms, None, None, Decimal(0)),
        )
        self.settlement(
            [self.transaction("200")], acquisition_id=acquisition, expected=settlement_version
        )
        self.kiosk(2, [self.component("-20")], expected=kiosk_version)
        self.fee(identity, [("2026-01-01", None, "7")])
        self.assertEqual(
            self.connection.execute(
                "select sum(company_amount) from public.live_company_components where authoritative"
            ).fetchone(),
            (Decimal(166),),
        )
        self.reassign(identity, None)
        self.assertEqual(payout_snapshot(self, report), before)
        for relation, column, version in (
            ("payout_report_settlement_versions", "version_id", settlement_version),
            ("payout_report_data_kiosk_versions", "version_id", kiosk_version),
            ("payout_report_terms_versions", "terms_version_id", terms),
        ):
            rows = self.connection.execute(
                sql.SQL("select {}::text from private.{} where report_id=%s").format(
                    sql.Identifier(column), sql.Identifier(relation)
                ),
                (report,),
            ).fetchall()
            if relation == "payout_report_data_kiosk_versions":
                self.assertEqual(len(rows), 30)
                self.assertIn((version,), rows)
            else:
                self.assertEqual(rows, [(version,)])
        self.connection.execute("set constraints all immediate")

    def test_manifest_retains_other_company_terms_used_to_exclude_rows(self) -> None:
        company, identity = self.owner()
        _, other_identity = self.owner("OTHER")
        own_terms = self.fee(identity, [("2026-01-01", None, "5")])
        other_terms = self.fee(other_identity, [("2026-01-01", None, "10")])
        settlement, _ = self.settlement(
            [self.transaction("100"), self.transaction("200", 4, sku="OTHER")]
        )
        report = self.report(company, [settlement])
        self.assertEqual(
            set(
                self.connection.execute(
                    "select terms_version_id::text from private.payout_report_terms_versions "
                    "where report_id=%s",
                    (report,),
                ).fetchall()
            ),
            {(own_terms,), (other_terms,)},
        )
        before = payout_snapshot(self, report)
        self.reassign(other_identity, company)
        self.assertEqual(payout_snapshot(self, report), before)
        self.assertEqual(
            self.connection.execute(
                "select sku from public.company_payout_report_components where report_id=%s",
                (report,),
            ).fetchall(),
            [("SKU",)],
        )
        self.connection.execute("set constraints all immediate")

    def test_company_report_access_survives_sku_transfer(self) -> None:
        company, identity = self.owner()
        other_company, _ = self.owner("OTHER")
        old_user, new_user = self.member(company), self.member(other_company)
        operator = self.operator()
        self.fee(identity, [("2026-01-01", None, "5")])
        settlement, _ = self.settlement([self.transaction("100")])
        report = self.report(company, [settlement])
        self.reassign(identity, other_company)
        self.connection.execute("set constraints all immediate")
        self.assertEqual(
            self.as_user(operator, "select id::text from public.company_payout_reports"),
            [(report,)],
        )
        self.assertEqual(
            self.as_user(
                operator, "select company_amount from public.company_payout_report_components"
            ),
            [(Decimal(95),)],
        )
        self.assertEqual(
            self.as_user(old_user, "select id::text from public.company_payout_reports"),
            [(report,)],
        )
        self.assertEqual(
            self.as_user(
                old_user, "select company_amount from public.company_payout_report_components"
            ),
            [(Decimal(95),)],
        )
        self.assertEqual(self.as_user(new_user, "select * from public.company_payout_reports"), [])
        self.assertEqual(
            self.as_user(new_user, "select * from public.company_payout_report_components"), []
        )
        self.assertEqual(
            self.as_user(old_user, "select id from private.settlement_transactions"), []
        )
        self.assertEqual(self.as_user(old_user, "select id from public.sku_terms_versions"), [])
        self.connection.execute("delete from public.app_accounts where user_id=%s", (operator,))
        self.assertEqual(self.as_user(operator, "select id from public.company_payout_reports"), [])

    def test_incomplete_ownership_fees_and_source_coverage_fail_atomically(self) -> None:
        company, identity = self.owner()
        settlement, _ = self.settlement([self.transaction("100")])
        for scope in ({}, {"marketplace_names": ["Amazon.com"]}):
            with (
                self.subTest(scope=scope),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.report(company, [settlement], **scope)
        self.reassign(identity, None)
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.report(company, [settlement])
        self.reassign(identity, company)
        self.fee(identity, [("2026-01-01", None, "0")])
        for scope in (
            {"preprocess_version": "another-version"},
            {"settlement_ids": [new_id()]},
            {"marketplace_names": ["Amazon.com", "Amazon.com"]},
        ):
            with (
                self.subTest(scope=scope),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.report(company, [settlement], **scope)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )
        report = self.report(company, [settlement])
        self.assertEqual(
            self.connection.execute(
                "select fee_amount,company_amount from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(0), Decimal(100)),
        )
        self.connection.execute("set constraints all immediate")

    def test_refund_uses_its_posting_date_rate_without_overcredit_adjustment(self) -> None:
        company, identity = self.owner()
        self.fee(identity, [("2026-01-01", "2026-06-15", "5"), ("2026-06-15", None, "7")])
        settlement, _ = self.settlement(
            [
                self.transaction("100", activity_date="2026-06-14"),
                self.transaction("-100", 4, kind="Refund"),
            ]
        )
        report = self.report(company, [settlement])
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount from public.company_payout_reports "
                "where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(0), Decimal(2), Decimal(2)),
        )
        self.connection.execute("set constraints all immediate")

    def test_deferred_validator_rejects_fabricated_component_and_missing_inputs(self) -> None:
        company, identity = self.owner()
        self.fee(identity, [("2026-01-01", None, "5")])
        settlement, _ = self.settlement([self.transaction("100")])
        for corrupt in ("component", "inputs"):
            with (
                self.subTest(corrupt=corrupt),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                report = self.report(company, [settlement])
                # Exercise deferred validation independently of the mutation guards.
                if corrupt == "component":
                    self.connection.execute(
                        "alter table public.company_payout_report_components "
                        "disable trigger immutable"
                    )
                    self.connection.execute(
                        "update public.company_payout_report_components set source_row_id=%s "
                        "where report_id=%s",
                        (new_id(), report),
                    )
                else:
                    self.connection.execute(
                        "alter table private.payout_report_settlement_versions "
                        "disable trigger immutable"
                    )
                    self.connection.execute(
                        "delete from private.payout_report_settlement_versions where report_id=%s",
                        (report,),
                    )
                self.connection.execute("set constraints all immediate")
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )
