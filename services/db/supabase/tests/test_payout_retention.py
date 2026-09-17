"""Payout source evidence retains payloads and requires fresh lock rechecks."""

from typing import LiteralString

import psycopg
from psycopg import sql

from services.db.supabase.tests.payout_fixtures import publish_report
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutRetentionTests(SourceModelFixture):
    def test_pruning_tombstones_cannot_be_erased(self) -> None:
        _, first = self.kiosk(1, [self.component()])
        current = first
        for observation in range(2, 5):
            _, current = self.kiosk(observation, [], expected=current)
        self.connection.commit()
        self.connection.execute("select private.prune_data_kiosk_preprocess()")
        self.connection.commit()
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute("truncate private.data_kiosk_pruned_versions")
        self.assertEqual(
            self.connection.execute(
                "select version_id::text from private.data_kiosk_pruned_versions"
            ).fetchall(),
            [(first,)],
        )

    def test_reports_preserve_whole_versions_and_empty_day_coverage(self) -> None:
        company, _ = self.owner()
        _, first = self.kiosk(1, [self.component("-10"), self.component("-3")])
        first_report = publish_report(self, company)
        second_report = publish_report(self, company)
        _, empty = self.kiosk(2, [], expected=first)
        empty_report = publish_report(self, company)
        current = empty
        for observation in range(3, 7):
            _, current = self.kiosk(observation, [self.component()], expected=current)
        self.connection.commit()

        self.assertEqual(
            self.connection.execute("select private.prune_data_kiosk_preprocess()").fetchone(),
            (1,),
        )
        self.assertEqual(
            self.connection.execute(
                "select version_id::text,count(*) "
                "from private.payout_report_data_kiosk_versions "
                "where report_id=any(%s::uuid[]) group by version_id order by version_id",
                ([first_report, second_report, empty_report],),
            ).fetchall(),
            [(first, 2), (empty, 1)],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*),sum(amount) from private.data_kiosk_transactions "
                "where version_id=%s",
                (first,),
            ).fetchone(),
            (2, -13),
        )
        self.assertEqual(
            self.connection.execute(
                "select v.row_count,count(t.id),count(p.version_id) "
                "from private.data_kiosk_preprocess_versions v "
                "left join private.data_kiosk_transactions t on t.version_id=v.id "
                "left join private.data_kiosk_pruned_versions p on p.version_id=v.id "
                "where v.id=%s group by v.row_count",
                (empty,),
            ).fetchone(),
            (0, 0, 0),
        )

    def test_report_source_dependencies_cannot_be_reassigned_or_deleted(self) -> None:
        company, _ = self.owner()
        _, first = self.kiosk(1, [self.component()])
        report = publish_report(self, company)
        _, later = self.kiosk(2, [], expected=first)
        self.connection.commit()
        statements: tuple[tuple[LiteralString, tuple[str, ...]], ...] = (
            (
                "update private.payout_report_data_kiosk_versions set version_id=%s "
                "where report_id=%s",
                (later, report),
            ),
            ("delete from private.payout_report_data_kiosk_versions where report_id=%s", (report,)),
            ("truncate private.payout_report_data_kiosk_versions", ()),
        )
        for statement, parameters in statements:
            with (
                self.subTest(statement=statement),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(statement, parameters)
        self.assertEqual(
            self.connection.execute(
                "select version_id::text from private.payout_report_data_kiosk_versions "
                "where report_id=%s",
                (report,),
            ).fetchone(),
            (first,),
        )

    def test_pruned_payload_cannot_be_attached_to_a_report(self) -> None:
        company, _ = self.owner()
        day, first = self.kiosk(1, [self.component()])
        current = first
        for observation in range(2, 5):
            _, current = self.kiosk(observation, [], expected=current)
        report = publish_report(self, company)
        self.connection.commit()
        self.connection.execute("select private.prune_data_kiosk_preprocess()")
        self.connection.commit()
        # Deliberately invalid direct SQL must fail before it can alter the frozen
        # inventory. Successful dependencies are always created by the publisher.
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "Pruned evidence"),
            self.connection.transaction(),
        ):
            self.connection.execute(
                "insert into private.payout_report_data_kiosk_versions "
                "(report_id,day_id,version_id) "
                "values (%s,%s,%s)",
                (report, day, first),
            )

    def test_source_payloads_cannot_be_truncated(self) -> None:
        self.settlement([self.transaction("1")])
        self.kiosk(1, [self.component()])
        self.connection.commit()
        for table in ("settlement_transactions", "data_kiosk_transactions"):
            with (
                self.subTest(table=table),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    sql.SQL("truncate {}").format(sql.Identifier("private", table))
                )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.settlement_transactions"
            ).fetchone(),
            (1,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_transactions"
            ).fetchone(),
            (1,),
        )

    def test_pruning_rejects_fixed_snapshot_transactions(self) -> None:
        statements: tuple[LiteralString, ...] = (
            "set transaction isolation level repeatable read",
            "set transaction isolation level serializable",
        )
        for statement in statements:
            with (
                self.subTest(statement=statement),
                self.assertRaisesRegex(psycopg.errors.InvalidTransactionState, "READ COMMITTED"),
                self.connection.transaction(),
            ):
                self.connection.execute(statement)
                self.connection.execute("select private.prune_data_kiosk_preprocess()")

    def test_report_publication_rejects_fixed_snapshot_transactions(self) -> None:
        company, _ = self.owner()
        self.kiosk(1, [])
        self.connection.commit()
        statements: tuple[LiteralString, ...] = (
            "set transaction isolation level repeatable read",
            "set transaction isolation level serializable",
        )
        for statement in statements:
            with (
                self.subTest(statement=statement),
                self.assertRaisesRegex(psycopg.errors.InvalidTransactionState, "READ COMMITTED"),
                self.connection.transaction(),
            ):
                self.connection.execute(statement)
                publish_report(self, company)
