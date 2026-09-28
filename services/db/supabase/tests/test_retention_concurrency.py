"""Retention and payout capture serialize against complete day publications."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import psycopg

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.isolated_database import isolated_database
from services.db.supabase.tests.payout_fixtures import fill_payout_kiosk_month, publish_report
from services.db.supabase.tests.retention_publication_schedule import (
    publish_while_pruning,
    report_while_pruning,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture


def _prune(database_url: str, name: str) -> str:
    with psycopg.connect(database_url, application_name=name) as connection:
        connection.execute("set statement_timeout='8s'")
        connection.execute("select private.prune_data_kiosk_preprocess()")
    return "committed"


def _history(connection: psycopg.Connection) -> list[str]:
    fixture = SourceModelFixture()
    fixture.connection = connection
    fixture.seller = "retention-seller"
    fixture.set_mature_cutoff_date(date(2026, 7, 1))
    versions: list[str] = []
    for observation in range(1, 6):
        _, version = fixture.kiosk(
            observation,
            [fixture.component()],
            expected=versions[-1] if versions else None,
        )
        versions.append(version)
    return versions


class RetentionConcurrencyTests(unittest.TestCase):
    def test_reverse_identity_order_publication_and_pruning_both_commit(self) -> None:
        self.assertEqual(publish_while_pruning(), ("committed", "committed"))

    def test_reverse_identity_order_report_and_pruning_both_commit(self) -> None:
        self.assertEqual(report_while_pruning(), ("committed", "committed"))

    def test_report_capture_blocks_source_replacement_then_protects_its_version(self) -> None:
        with isolated_database() as database_url:
            with psycopg.connect(database_url) as setup:
                fixture = SourceModelFixture()
                fixture.connection = setup
                fixture.seller = "report-source-seller"
                fixture.set_mature_cutoff_date(date(2026, 7, 1))
                company, _ = fixture.owner()
                _, first = fixture.kiosk(1, [fixture.component()])
                fill_payout_kiosk_month(fixture)
            with (
                psycopg.connect(database_url) as capturing,
                psycopg.connect(database_url, autocommit=True) as observer,
                ThreadPoolExecutor(max_workers=1) as executor,
            ):
                fixture.connection = capturing
                report = publish_report(fixture, company)

                def publish_new_observations() -> str:
                    with psycopg.connect(
                        database_url, application_name="source-after-report"
                    ) as publishing:
                        publishing.execute("set statement_timeout='8s'")
                        source = SourceModelFixture()
                        source.connection = publishing
                        source.seller = fixture.seller
                        current = first
                        for observation in range(2, 6):
                            _, current = source.kiosk(observation, [], expected=current)
                        return current

                publication = executor.submit(publish_new_observations)
                try:
                    wait_for_block(observer, "source-after-report")
                finally:
                    capturing.commit()
                publication.result(timeout=10)
                self.assertEqual(
                    observer.execute("select private.prune_data_kiosk_preprocess()").fetchone(),
                    (1,),
                )
                self.assertEqual(
                    observer.execute(
                        "select p.version_id::text,count(t.id) "
                        "from private.payout_report_data_kiosk_versions p "
                        "left join private.data_kiosk_transactions t on t.version_id=p.version_id "
                        "where p.report_id=%s and p.version_id=%s group by p.version_id",
                        (report, first),
                    ).fetchone(),
                    (first, 1),
                )

    def test_report_capture_waits_for_pruning_then_uses_current_retained_version(self) -> None:
        with isolated_database() as database_url:
            with psycopg.connect(database_url) as setup:
                fixture = SourceModelFixture()
                fixture.connection = setup
                fixture.seller = "retention-seller"
                company, _ = fixture.owner()
                versions = _history(setup)
                fill_payout_kiosk_month(fixture)
            with (
                psycopg.connect(database_url) as pruning,
                psycopg.connect(database_url, autocommit=True) as observer,
                ThreadPoolExecutor(max_workers=1) as executor,
            ):
                pruning.execute("select private.prune_data_kiosk_preprocess()")

                def capture_report() -> str:
                    with psycopg.connect(
                        database_url, application_name="report-after-retention"
                    ) as capturing:
                        capturing.execute("set statement_timeout='8s'")
                        report_fixture = SourceModelFixture()
                        report_fixture.connection = capturing
                        report_fixture.seller = fixture.seller
                        return publish_report(report_fixture, company)

                report_future = executor.submit(capture_report)
                try:
                    wait_for_block(observer, "report-after-retention")
                finally:
                    pruning.commit()
                report = report_future.result(timeout=10)
                self.assertEqual(
                    observer.execute(
                        "select version_id::text from private.payout_report_data_kiosk_versions "
                        "where report_id=%s and version_id=%s",
                        (report, versions[-1]),
                    ).fetchall(),
                    [(versions[-1],)],
                )

    def test_competing_pruners_recheck_completed_work_after_waiting(self) -> None:
        with isolated_database() as database_url:
            with psycopg.connect(database_url) as setup:
                _history(setup)
            with (
                psycopg.connect(database_url) as first,
                psycopg.connect(database_url, autocommit=True) as observer,
                ThreadPoolExecutor(max_workers=1) as executor,
            ):
                first.execute("select private.prune_data_kiosk_preprocess()")
                second = executor.submit(
                    _prune,
                    database_url,
                    "second-retention",
                )
                try:
                    wait_for_block(observer, "second-retention")
                finally:
                    first.commit()
                self.assertEqual(second.result(timeout=10), "committed")
                self.assertEqual(
                    observer.execute(
                        "select count(*) from private.data_kiosk_pruned_versions"
                    ).fetchone(),
                    (2,),
                )
