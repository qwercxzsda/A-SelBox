"""Frozen payouts preserve exact observations across immutable source history."""

from typing import LiteralString

import psycopg
from psycopg import sql

from services.db.supabase.tests.payout_fixtures import payout_snapshot, publish_report
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutSourceHistoryTests(SourceModelFixture):
    def test_reports_preserve_whole_versions_and_empty_day_coverage(self) -> None:
        company, _ = self.owner()
        _, first = self.kiosk(1, [self.component("-10"), self.component("-3")])
        first_report = publish_report(self, company)
        _, empty = self.kiosk(2, [], expected=first)
        empty_report = publish_report(self, company)
        current = empty
        for observation in range(3, 7):
            _, current = self.kiosk(observation, [self.component()], expected=current)
        self.connection.commit()

        self.assertEqual(
            self.connection.execute(
                "select version_id::text,count(*) "
                "from private.payout_report_data_kiosk_observations "
                "where report_id=any(%s::uuid[]) and version_id=any(%s::uuid[]) "
                "group by version_id order by version_id",
                ([first_report, empty_report], [first, empty]),
            ).fetchall(),
            [(first, 1), (empty, 1)],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*),sum(amount) from private.data_kiosk_day_components "
                "where version_id=%s",
                (first,),
            ).fetchone(),
            (2, -13),
        )
        self.assertEqual(
            self.connection.execute(
                "select v.row_count,count(t.id) "
                "from private.data_kiosk_day_versions v "
                "left join private.data_kiosk_day_components t on t.version_id=v.id "
                "where v.id=%s group by v.row_count",
                (empty,),
            ).fetchone(),
            (0, 0),
        )

    def test_shared_version_keeps_each_observations_preprocessing_identity(self) -> None:
        company, _ = self.owner()
        components = [self.component("-10")]
        day, version = self.kiosk(1, components)
        first_observation = self.kiosk_observation(version)
        report = publish_report(self, company)
        before = payout_snapshot(self, report)
        _, reused = self.kiosk(2, components, expected=version, version="v1")
        second_observation = self.kiosk_observation(reused)
        self.assertEqual(reused, version)
        self.assertNotEqual(first_observation, second_observation)
        self.assertEqual(payout_snapshot(self, report), before)
        self.assertEqual(
            self.connection.execute(
                "select p.batch_id=m.batch_id,p.version_id=m.version_id "
                "from private.payout_report_data_kiosk_observations p "
                "join private.data_kiosk_preprocess_batch_days m on m.id=%s "
                "where p.report_id=%s and p.day_id=%s",
                (first_observation, report, day),
            ).fetchone(),
            (True, True),
        )
        for observation, label in ((first_observation, "v0"), (second_observation, "v1")):
            with self.subTest(preprocess_version=label):
                self.assertEqual(
                    self.connection.execute(
                        "select preprocess_version,source_version_id::text "
                        "from private.resolve_company_components('{}',%s::uuid[],'{}') "
                        "where source='DATA_KIOSK'",
                        ([observation],),
                    ).fetchall(),
                    [(label, version)],
                )
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "One interpretation"),
            self.connection.transaction(),
        ):
            self.connection.execute(
                "select * from private.resolve_company_components('{}',%s::uuid[],'{}')",
                ([first_observation, second_observation],),
            )
        # The original report's deferred validation must still use its original observation.
        self.connection.execute("set constraints all immediate")

    def test_repeated_observations_of_shared_contents_do_not_duplicate_amounts(self) -> None:
        components = [self.component("-10")]
        _, version = self.kiosk(1, components)
        first = self.kiosk_observation(version)
        _, reused = self.kiosk(2, components, expected=version)
        second = self.kiosk_observation(reused)
        self.assertEqual(reused, version)
        self.assertNotEqual(first, second)
        self.assertEqual(
            self.connection.execute(
                "select count(*),sum(source_amount) "
                "from private.resolve_company_components('{}',%s::uuid[],'{}') "
                "where source='DATA_KIOSK'",
                ([first, second],),
            ).fetchone(),
            (1, -10),
        )

    def test_report_source_dependencies_cannot_be_reassigned_or_deleted(self) -> None:
        company, _ = self.owner()
        _, first = self.kiosk(1, [self.component()])
        report = publish_report(self, company)
        _, later = self.kiosk(2, [], expected=first)
        self.connection.commit()
        statements: tuple[tuple[LiteralString, tuple[str, ...]], ...] = (
            (
                "update private.payout_report_data_kiosk_observations set version_id=%s "
                "where report_id=%s",
                (later, report),
            ),
            (
                "delete from private.payout_report_data_kiosk_observations where report_id=%s",
                (report,),
            ),
            ("truncate private.payout_report_data_kiosk_observations", ()),
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
                "select version_id::text from private.payout_report_data_kiosk_observations "
                "where report_id=%s and version_id=%s",
                (report, first),
            ).fetchone(),
            (first,),
        )

    def test_source_payloads_cannot_be_truncated(self) -> None:
        self.finances([self.transaction("1")])
        self.kiosk(1, [self.component()])
        self.connection.commit()
        for table in ("finances_transaction_components", "data_kiosk_day_components"):
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
                "select count(*) from private.finances_transaction_components"
            ).fetchone(),
            (1,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_day_components"
            ).fetchone(),
            (1,),
        )

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
