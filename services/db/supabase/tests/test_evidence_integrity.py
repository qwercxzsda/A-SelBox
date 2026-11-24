"""Published evidence stays immutable and rejects invalid report references."""

import psycopg
from psycopg import sql

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import publish_report
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class EvidenceIntegrityTests(SourceModelFixture):
    report = publish_report

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
            ("private", "source_acquisitions"),
            ("private", "source_unit_versions"),
            ("public", "assignment_versions"),
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

    def test_a_report_cannot_pin_the_same_version_twice_or_under_another_identity(self) -> None:
        earlier, _ = self.finances([self.transaction("10", activity_date="2026-05-01")])
        other_unit = require_row(
            self.connection.execute(
                "select unit_id from private.source_batch_units where batch_id=%s", (earlier,)
            ).fetchone()
        )[0]
        report, other_key, _ = self.published_evidence()
        for table, identity, wrong_identity in (
            ("payout_report_source_versions", "unit_id", other_unit),
            ("payout_report_assignment_versions", "key_id", other_key),
        ):
            relation = sql.Identifier("private", table)
            key = sql.Identifier(identity)
            with (
                self.subTest(table=table, duplicate=True),
                self.assertRaises(psycopg.errors.UniqueViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    sql.SQL("insert into {0} select * from {0} where report_id=%s limit 1").format(
                        relation
                    ),
                    (report,),
                )
            with (
                self.subTest(table=table, wrong_identity=True),
                self.assertRaises(psycopg.errors.ForeignKeyViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    sql.SQL(
                        "insert into {} (report_id,{},version_id) "
                        "select report_id,%s,version_id from {} where report_id=%s limit 1"
                    ).format(relation, key, relation),
                    (wrong_identity, report),
                )

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
                    "insert into private.payout_report_assignment_versions "
                    "(report_id,key_id,version_id) values (%s,%s,%s)",
                    (report_id, sku_id, terms_id),
                )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.payout_report_assignment_versions where report_id=%s",
                (report,),
            ).fetchone(),
            (1,),
        )
