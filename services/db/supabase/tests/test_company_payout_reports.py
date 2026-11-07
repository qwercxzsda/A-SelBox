"""Frozen payout economics, administrator access, and complete evidence validation."""

from decimal import Decimal

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    payout_snapshot,
    report_records,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class CompanyPayoutReportTests(SourceModelFixture):
    def report(self, company: str, **scope: object) -> str:
        fill_payout_kiosk_month(self)
        return self.call(
            "publish_company_payout_report",
            {
                "id": new_id(),
                "company_id": company,
                "marketplace_name": "Amazon.com",
                "currency": "USD",
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "dataset_key": "economics",
                "report_name": "June entitlement",
                "change_reason": "Save exact source and terms inputs",
                **scope,
            },
        )

    def reassign(self, identity: str, company: str | None) -> str:
        row = self.connection.execute(
            "select sku,current_terms_version_id from public.skus where id=%s",
            (identity,),
        ).fetchone()
        if row is None:
            raise AssertionError("Expected SKU identity.")
        return self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": identity,
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
        _, finances_version = self.finances([self.transaction("100")], acquisition_id=acquisition)
        _, kiosk_version = self.kiosk(1, [self.component()])
        report = self.report(company)
        before = payout_snapshot(self, report)
        details = report_records(self, report)
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount "
                "from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(90), Decimal(-5), Decimal(85)),
        )
        kiosk_detail = next(row for row in details if row["source"] == "DATA_KIOSK")
        self.assertEqual(
            tuple(
                kiosk_detail[field]
                for field in ("terms_version_id", "fee_period_id", "fee_rate_percent", "fee_amount")
            ),
            (terms, None, None, "0"),
        )
        self.finances([self.transaction("200")], acquisition_id=acquisition)
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
        self.assertEqual(report_records(self, report), details)
        for relation, column, version in (
            ("payout_report_finances_versions", "version_id", finances_version),
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
        self.finances([self.transaction("100"), self.transaction("200", 4, sku="OTHER")])
        report = self.report(company)
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
        self.assertEqual([row["sku"] for row in report_records(self, report)], ["SKU"])
        self.connection.execute("set constraints all immediate")

    def test_detail_count_includes_supporting_rows_without_adding_their_amounts(self) -> None:
        company, identity = self.owner()
        self.fee(identity, [("2026-01-01", None, "5")])
        self.finances([self.transaction("100")])
        self.kiosk(
            1,
            [
                self.component("-10"),
                self.component("999", category="FINANCES")
                | {"component_type": "NET_PRODUCT_SALES", "fee_base": "999"},
                self.component("123", category="ANALYSIS_ONLY"),
            ],
        )
        report = self.report(company)
        self.assertEqual(
            self.connection.execute(
                "select component_count,source_amount,fee_amount,company_amount "
                "from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (4, 90, -5, 85),
        )
        supporting = report_records(self, report, authoritative=False)
        self.assertEqual(len(supporting), 2)
        self.assertEqual({row["source_amount"] for row in supporting}, {"999", "123"})
        self.assertTrue(all(row["company_amount"] is None for row in supporting))
        self.connection.execute("set constraints all immediate")

    def test_company_report_access_survives_sku_transfer(self) -> None:
        company, identity = self.owner()
        other_company, _ = self.owner("OTHER")
        old_user, new_user = self.member(company), self.member(other_company)
        administrator = self.administrator()
        self.fee(identity, [("2026-01-01", None, "5")])
        self.finances([self.transaction("100")])
        report = self.report(company)
        self.reassign(identity, other_company)
        self.connection.execute("set constraints all immediate")
        self.assertEqual(
            self.as_user(administrator, "select id::text from public.company_payout_reports"),
            [(report,)],
        )
        self.assertEqual(
            [
                Decimal(row["company_amount"])
                for row in report_records(self, report, user=administrator)
            ],
            [Decimal(95)],
        )
        self.assertEqual(
            self.as_user(old_user, "select id::text from public.company_payout_reports"),
            [(report,)],
        )
        self.assertEqual(
            [Decimal(row["company_amount"]) for row in report_records(self, report, user=old_user)],
            [Decimal(95)],
        )
        self.assertEqual(self.as_user(new_user, "select * from public.company_payout_reports"), [])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            report_records(self, report, user=new_user)
        self.assertEqual(
            self.as_user(old_user, "select id from private.finances_transaction_components"), []
        )
        self.assertEqual(self.as_user(old_user, "select id from public.sku_terms_versions"), [])
        self.connection.execute(
            "delete from public.app_accounts where user_id=%s", (administrator,)
        )
        self.assertEqual(
            self.as_user(administrator, "select id from public.company_payout_reports"), []
        )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            report_records(self, report, user=administrator)

    def test_incomplete_ownership_fees_and_source_coverage_fail_atomically(self) -> None:
        company, identity = self.owner()
        self.finances([self.transaction("100")])
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.report(company)
        self.reassign(identity, None)
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.report(company)
        self.reassign(identity, company)
        self.fee(identity, [("2026-01-01", None, "0")])
        for scope in (
            {"preprocess_version": "another-version"},
            {"finances_version_ids": [new_id()]},
            {"marketplace_name": "Unsupported marketplace"},
        ):
            with (
                self.subTest(scope=scope),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.report(company, **scope)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )
        report = self.report(company)
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
        self.finances(
            [
                self.transaction("100", activity_date="2026-06-14"),
                self.transaction("-100", 4, kind="Refund"),
            ]
        )
        report = self.report(company)
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount from public.company_payout_reports "
                "where id=%s",
                (report,),
            ).fetchone(),
            (Decimal(0), Decimal(2), Decimal(2)),
        )
        self.connection.execute("set constraints all immediate")

    def test_deferred_validator_rejects_incorrect_totals_count_and_missing_inputs(self) -> None:
        company, identity = self.owner()
        self.fee(identity, [("2026-01-01", None, "5")])
        self.finances([self.transaction("100")])
        report = self.report(company)
        self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all deferred")
        for corrupt in ("amounts", "count", "inputs"):
            with (
                self.subTest(corrupt=corrupt),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                candidate = new_id()
                changes: dict[str, object] = {"id": candidate}
                if corrupt == "amounts":
                    changes |= {"source_amount": "101", "company_amount": "96"}
                elif corrupt == "count":
                    changes |= {"component_count": 2}
                self.connection.execute(
                    "insert into public.company_payout_reports "
                    "select (jsonb_populate_record(r,%s::jsonb)).* "
                    "from public.company_payout_reports r where id=%s",
                    (Jsonb(changes), report),
                )
                for table, identity_column, version_column in (
                    ("payout_report_finances_versions", "transaction_id", "version_id"),
                    ("payout_report_data_kiosk_versions", "day_id", "version_id"),
                    ("payout_report_terms_versions", "sku_id", "terms_version_id"),
                ):
                    if corrupt == "inputs" and table == "payout_report_finances_versions":
                        continue
                    self.connection.execute(
                        sql.SQL(
                            "insert into private.{} select %s,{},{} "
                            "from private.{} where report_id=%s"
                        ).format(
                            sql.Identifier(table),
                            sql.Identifier(identity_column),
                            sql.Identifier(version_column),
                            sql.Identifier(table),
                        ),
                        (candidate, report),
                    )
                self.connection.execute("set constraints all immediate")
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (1,),
        )
