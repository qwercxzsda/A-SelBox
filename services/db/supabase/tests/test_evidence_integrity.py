"""Published evidence stays immutable and rejects invalid report references."""

import psycopg
from psycopg import sql

from services.db.supabase.tests import test_company_payout_reports as payout_fixture
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class EvidenceIntegrityTests(SourceModelFixture):
    report = payout_fixture.CompanyPayoutReportTests.report

    def published_evidence(self) -> tuple[str, str, str]:
        company, identity = self.owner()
        _, other_identity = self.owner("OTHER")
        self.fee(identity, [("2026-01-01", None, "5")])
        other_terms = self.fee(other_identity, [("2026-01-01", None, "5")])
        self.finances([self.transaction("100")])
        report = self.report(company)
        self.connection.execute("set constraints all immediate")
        return report, other_identity, other_terms

    def test_source_and_terms_parent_mutations_are_rejected_before_fk_checks(self) -> None:
        self.published_evidence()
        for schema, table in (
            ("private", "finances_acquisitions"),
            ("private", "finances_transaction_versions"),
            ("public", "sku_terms_versions"),
            ("public", "sku_fee_periods"),
        ):
            relation = sql.Identifier(schema, table)
            statements = (
                sql.SQL("update {} set id=id").format(relation),
                sql.SQL("delete from {}").format(relation),
                sql.SQL("truncate {} cascade").format(relation),
            )
            for statement in statements:
                with (
                    self.subTest(table=table, statement=statement.as_string(self.connection)),
                    self.assertRaisesRegex(psycopg.errors.CheckViolation, "immutable"),
                    self.connection.transaction(),
                ):
                    self.connection.execute(statement)

    def test_report_terms_reject_missing_or_misbound_revision_references(self) -> None:
        _, third_identity = self.owner("THIRD")
        report, other_identity, other_terms = self.published_evidence()
        for report_id, sku_id, terms_id in (
            (new_id(), other_identity, other_terms),
            (report, new_id(), other_terms),
            (report, other_identity, new_id()),
            (report, third_identity, other_terms),
        ):
            with (
                self.assertRaises(psycopg.errors.ForeignKeyViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "insert into private.payout_report_terms_versions "
                    "(report_id,sku_id,terms_version_id) values (%s,%s,%s)",
                    (report_id, sku_id, terms_id),
                )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.payout_report_terms_versions where report_id=%s",
                (report,),
            ).fetchone(),
            (1,),
        )
