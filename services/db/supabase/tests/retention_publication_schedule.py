"""Schedule competing day publications and retention in isolated database tests.

This schedules the production publication and retention functions against day
identities created in reverse date order. Both must commit on a disposable
database; no persistent development data is changed.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import LiteralString

import psycopg
from psycopg.types.json import Jsonb

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.isolated_database import isolated_database
from services.db.supabase.tests.payout_fixtures import fill_payout_kiosk_month, publish_report
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id

_BARRIER = 812340
_REPORT_BARRIER = 812341


def _prepare(database_url: str) -> dict[str, object]:
    """Create day identities in reverse date order, each with prunable history."""
    current: dict[str, str] = {}
    with psycopg.connect(database_url) as connection:
        fixture = SourceModelFixture()
        fixture.connection = connection
        fixture.seller = "retention-deadlock-seller"
        fixture.set_mature_cutoff_date(date(2026, 7, 1))
        for activity_date in ("2026-06-16", "2026-06-15"):
            for observation in range(1, 5):
                acquisition_id = fixture.kiosk_acquisition(observation, start=activity_date)
                version_id = new_id()
                fixture.call(
                    "publish_data_kiosk_preprocess",
                    {
                        "id": new_id(),
                        "acquisition_id": acquisition_id,
                        "preprocess_version": "v0",
                        "dataset_key": "economics",
                        "days": [
                            {
                                "id": version_id,
                                "marketplace_name": "Amazon.com",
                                "activity_date": activity_date,
                                "expected_current_version_id": current.get(activity_date),
                                "content_sha256": "a" * 64,
                                "transactions": [fixture.component()],
                            }
                        ],
                    },
                )
                current[activity_date] = version_id
        acquisition_id = fixture.kiosk_acquisition(5, start="2026-06-15", end="2026-06-16")
        # This test-only scheduling hook does not change production lock ordering.
        connection.execute("""
            create function private.pause_test_publication() returns trigger
            language plpgsql as $$ begin
                if current_setting('test.pause_publication', true) = 'on'
                    and new.activity_date = '2026-06-15'::date then
                    perform pg_advisory_xact_lock(812340);
                end if;
                return new;
            end; $$;
            create trigger pause_test_publication
                before update on private.data_kiosk_days for each row
                execute function private.pause_test_publication();
        """)
    return {
        "id": new_id(),
        "acquisition_id": acquisition_id,
        "preprocess_version": "v0",
        "dataset_key": "economics",
        "days": [
            {
                "id": new_id(),
                "marketplace_name": "Amazon.com",
                "activity_date": activity_date,
                "expected_current_version_id": current[activity_date],
                "content_sha256": "b" * 64,
                "transactions": [],
            }
            for activity_date in sorted(current)
        ],
    }


def _execute(
    database_url: str, name: str, statement: LiteralString, payload: dict[str, object] | None = None
) -> str:
    try:
        with psycopg.connect(database_url, application_name=name) as connection:
            connection.execute("set deadlock_timeout = '100ms'")
            connection.execute("set statement_timeout = '10s'")
            if payload is not None:
                connection.execute("set local test.pause_publication = 'on'")
                connection.execute(statement, (Jsonb(payload),))
            else:
                connection.execute(statement)
        return "committed"
    except psycopg.errors.DeadlockDetected:
        return "deadlock detected"


def publish_while_pruning() -> tuple[str, str]:
    """Interleave publication and pruning and require both operations to commit."""
    with isolated_database() as database_url:
        payload = _prepare(database_url)
        with psycopg.connect(database_url, autocommit=True) as controller:
            controller.execute("select pg_advisory_lock(%s)", (_BARRIER,))
            with ThreadPoolExecutor(max_workers=2) as workers:
                publication = workers.submit(
                    _execute,
                    database_url,
                    "test-publication",
                    "select private.publish_data_kiosk_preprocess(%s::jsonb)",
                    payload,
                )
                try:
                    wait_for_block(controller, "test-publication", wait_event="advisory")
                    retention = workers.submit(
                        _execute,
                        database_url,
                        "test-retention",
                        "select private.prune_data_kiosk_preprocess()",
                    )
                    wait_for_block(controller, "test-retention", wait_event="transactionid")
                finally:
                    controller.execute("select pg_advisory_unlock(%s)", (_BARRIER,))
                outcomes = (publication.result(timeout=12), retention.result(timeout=12))
        if outcomes != ("committed", "committed"):
            raise AssertionError(f"Unexpected concurrent publication outcomes: {outcomes}")
        with psycopg.connect(database_url) as connection:
            if connection.execute(
                "select count(*) from private.data_kiosk_days d "
                "join private.data_kiosk_preprocess_versions v on v.id=d.current_version_id "
                "where v.row_count=0"
            ).fetchone() != (2,):
                raise AssertionError("Both complete empty-day replacements must be current.")
            if connection.execute(
                "select count(*) from private.data_kiosk_pruned_versions"
            ).fetchone() != (2,):
                raise AssertionError("Pruning must remove the two initially eligible day payloads.")
        return outcomes


def report_while_pruning() -> tuple[str, str]:
    """Prune day one while report capture waits before taking day two's lock."""
    with isolated_database() as database_url:
        _prepare(database_url)
        with psycopg.connect(database_url) as connection:
            fixture = SourceModelFixture()
            fixture.connection = connection
            fixture.seller = "retention-deadlock-seller"
            company, _ = fixture.owner()
            fill_payout_kiosk_month(fixture)
            connection.execute("""
                create function private.pause_test_retention() returns trigger
                language plpgsql as $$ begin
                    if current_setting('test.pause_retention', true) = 'on'
                        and exists (
                            select 1 from private.data_kiosk_preprocess_versions v
                            join private.data_kiosk_days d on d.id=v.day_id
                            where v.id=new.version_id and d.activity_date='2026-06-15'::date
                        ) then
                        perform pg_advisory_xact_lock(812341);
                    end if;
                    return new;
                end; $$;
                create trigger pause_test_retention
                    after insert on private.data_kiosk_pruned_versions for each row
                    execute function private.pause_test_retention();
            """)

        def prune() -> str:
            with psycopg.connect(
                database_url, application_name="retention-before-report"
            ) as connection:
                connection.execute("set deadlock_timeout='100ms'")
                connection.execute("set statement_timeout='10s'")
                connection.execute("set local test.pause_retention='on'")
                connection.execute("select private.prune_data_kiosk_preprocess()")
            return "committed"

        def report() -> str:
            with psycopg.connect(
                database_url, application_name="report-after-first-day"
            ) as connection:
                connection.execute("set deadlock_timeout='100ms'")
                connection.execute("set statement_timeout='10s'")
                fixture.connection = connection
                publish_report(fixture, company)
            return "committed"

        with psycopg.connect(database_url, autocommit=True) as controller:
            controller.execute("select pg_advisory_lock(%s)", (_REPORT_BARRIER,))
            with ThreadPoolExecutor(max_workers=2) as workers:
                retention = workers.submit(prune)
                try:
                    wait_for_block(controller, "retention-before-report", wait_event="advisory")
                    capture = workers.submit(report)
                    wait_for_block(controller, "report-after-first-day", wait_event="transactionid")
                finally:
                    controller.execute("select pg_advisory_unlock(%s)", (_REPORT_BARRIER,))
                outcomes = (retention.result(timeout=12), capture.result(timeout=12))
            if controller.execute(
                "select count(*) from private.payout_report_data_kiosk_versions p "
                "join private.data_kiosk_days d on d.current_version_id=p.version_id"
            ).fetchone() != (30,):
                raise AssertionError("The report must capture the complete month of current days.")
            if controller.execute(
                "select count(*) from private.data_kiosk_pruned_versions"
            ).fetchone() != (2,):
                raise AssertionError("Both initially eligible old day versions must be pruned.")
        return outcomes
