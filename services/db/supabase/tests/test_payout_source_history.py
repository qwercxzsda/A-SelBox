"""Frozen payouts preserve immutable versions independently of observation history."""

from datetime import date
from typing import LiteralString

import psycopg
from psycopg import sql

from services.db.supabase.tests.payout_fixtures import (
    payout_snapshot,
    prepare_payout,
    publish_payout,
    publish_report,
    report_records,
)
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
                "from private.payout_report_data_kiosk_versions "
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

    def test_reused_version_has_no_frozen_observation_or_processing_label_dependency(self) -> None:
        company, _ = self.owner()
        components = [self.component("-10")]
        day, version = self.kiosk(1, components)
        first_observation = self.kiosk_observation(version)
        report = publish_report(self, company)
        before = payout_snapshot(self, report)
        _, reused = self.kiosk(2, components, expected=version, version="v1")
        self.assertEqual(reused, version)
        self.assertNotEqual(self.kiosk_observation(reused), first_observation)
        self.assertEqual(payout_snapshot(self, report), before)
        self.assertEqual(
            self.connection.execute(
                "select version_id::text from private.payout_report_data_kiosk_versions "
                "where report_id=%s and day_id=%s",
                (report, day),
            ).fetchone(),
            (version,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*),sum(source_amount) from "
                "private.resolve_company_components('{}',%s::uuid[],'{}') "
                "where source='DATA_KIOSK'",
                ([version, reused],),
            ).fetchone(),
            (1, -10),
        )
        self.connection.execute("set constraints all immediate")

    def test_frozen_resolution_ignores_later_maturity_and_current_source_selections(self) -> None:
        inputs = prepare_payout(self)
        report = publish_payout(self, inputs)
        saved = payout_snapshot(self, report)
        details = report_records(self, report)
        terms = [
            str(row[0])
            for row in self.connection.execute(
                "select terms_version_id from private.payout_report_terms_versions "
                "where report_id=%s",
                (report,),
            ).fetchall()
        ]
        self.connection.commit()
        self.finances([self.transaction("500")])
        self.kiosk(2, [self.component("-40")], expected=inputs.kiosk_version)
        self.fee(inputs.sku_identity, [("2026-01-01", None, "37")])
        self.set_mature_cutoff_date(date(2026, 1, 1))
        self.assertEqual(
            self.connection.execute(
                "select sum(company_amount) from private.resolve_company_components("
                "%s::uuid[],%s::uuid[],%s::uuid[]) where authoritative",
                ([inputs.finances_version], [inputs.kiosk_version], terms),
            ).fetchone(),
            (85,),
        )
        self.assertEqual(payout_snapshot(self, report), saved)
        self.assertEqual(report_records(self, report), details)

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
            (
                "delete from private.payout_report_data_kiosk_versions where report_id=%s",
                (report,),
            ),
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
