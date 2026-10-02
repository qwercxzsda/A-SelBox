"""Input publication and queue acknowledgments cannot lose a newer revision."""

from concurrent.futures import ThreadPoolExecutor

import psycopg
from psycopg.conninfo import make_conninfo

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL
from services.db.supabase.tests.payout_fixtures import prepare_payout, refresh_payout_reports
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutRefreshConcurrencyTests(SourceModelFixture):
    def test_cross_company_requests_serialize_before_touching_opposite_state_rows(self) -> None:
        inputs = prepare_payout(self)
        other, _ = self.owner("OTHER")
        refresh_payout_reports(self)
        self.connection.commit()
        before = dict(
            self.connection.execute(
                "select company_id::text,requested_revision "
                "from private.payout_report_refresh_state "
                "where month='2026-06-01'"
            ).fetchall()
        )
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)

        def request(connection: psycopg.Connection, company: str) -> None:
            connection.execute(
                "select private.request_payout_report_refresh(array[date '2026-06-01'],"
                "array[%s::uuid])",
                (company,),
            )

        with (
            psycopg.connect(database_url) as first,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            first.execute("set statement_timeout='10s'")
            request(first, inputs.company)

            def opposite_requests() -> None:
                with psycopg.connect(
                    database_url, application_name="cross-company-payout-requests"
                ) as second:
                    second.execute("set statement_timeout='10s'")
                    request(second, other)
                    request(second, inputs.company)

            future = executor.submit(opposite_requests)
            try:
                wait_for_block(observer, "cross-company-payout-requests", wait_event="advisory")
                observer.execute(
                    "select 1 from private.payout_report_refresh_state "
                    "where company_id=%s and month='2026-06-01' for update nowait",
                    (other,),
                )
                request(first, other)
            finally:
                first.commit()
            future.result(timeout=12)
        after = dict(
            self.connection.execute(
                "select company_id::text,requested_revision "
                "from private.payout_report_refresh_state "
                "where month='2026-06-01'"
            ).fetchall()
        )
        self.assertEqual(after, {company: revision + 2 for company, revision in before.items()})
        self.assertEqual(refresh_payout_reports(self), (2, 0, 2, 0))

    def test_overlapping_source_and_fee_publications_both_leave_the_latest_inputs_pending(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        refresh_payout_reports(self)
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as source_connection,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            source = SourceModelFixture()
            source.connection, source.seller = source_connection, self.seller
            source_connection.execute("set statement_timeout='10s'")
            source.settlement(
                [source.transaction("200")],
                acquisition_id=inputs.acquisition,
                expected=inputs.settlement_version,
            )

            def change_fee() -> None:
                with psycopg.connect(
                    database_url, application_name="overlapping-payout-inputs"
                ) as connection:
                    connection.execute("set statement_timeout='10s'")
                    terms = SourceModelFixture()
                    terms.connection, terms.seller = connection, self.seller
                    terms.fee(inputs.sku_identity, [("2026-01-01", None, "10")])

            future = executor.submit(change_fee)
            try:
                wait_for_block(observer, "overlapping-payout-inputs")
            finally:
                source_connection.commit()
            future.result(timeout=12)
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select company_amount from public.company_payout_reports "
                "where company_id=%s order by created_at desc,id desc limit 1",
                (inputs.company,),
            ).fetchone(),
            (170,),
        )
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))

    def test_active_source_publication_makes_worker_skip_without_waiting(self) -> None:
        inputs = prepare_payout(self)
        refresh_payout_reports(self)
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with psycopg.connect(database_url) as publisher, psycopg.connect(database_url) as worker:
            source = SourceModelFixture()
            source.connection, source.seller = publisher, self.seller
            source.fee(inputs.sku_identity, [("2026-01-01", None, "7")])
            worker.execute("set statement_timeout='2s'")
            self.assertEqual(
                worker.execute("select * from private.refresh_company_payout_reports()").fetchone(),
                (0, 0, 0, 0),
            )
            worker.commit()
            publisher.commit()
            self.assertEqual(
                worker.execute("select * from private.refresh_company_payout_reports()").fetchone(),
                (1, 1, 0, 0),
            )

    def test_publication_waiting_for_generation_remains_pending_after_worker_commit(self) -> None:
        inputs = prepare_payout(self)
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as worker,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            worker.execute("set statement_timeout='10s'")
            self.assertEqual(
                worker.execute("select * from private.refresh_company_payout_reports()").fetchone(),
                (1, 1, 0, 0),
            )

            def change_fee() -> None:
                with psycopg.connect(
                    database_url, application_name="payout-fee-publication"
                ) as connection:
                    connection.execute("set statement_timeout='10s'")
                    source = SourceModelFixture()
                    source.connection, source.seller = connection, self.seller
                    source.fee(inputs.sku_identity, [("2026-01-01", None, "8")])

            future = executor.submit(change_fee)
            try:
                wait_for_block(observer, "payout-fee-publication", wait_event="advisory")
            finally:
                worker.commit()
            future.result(timeout=12)
        self.assertEqual(
            self.connection.execute(
                "select requested_revision>completed_revision "
                "from private.payout_report_refresh_state "
                "where company_id=%s and month='2026-06-01'",
                (inputs.company,),
            ).fetchone(),
            (True,),
        )
        self.assertEqual(refresh_payout_reports(self), (1, 1, 0, 0))
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))

    def test_request_committed_while_worker_waits_is_not_acknowledged_by_older_revision(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as holder,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            holder.execute(
                "select pg_advisory_xact_lock(hashtextextended(jsonb_build_array("
                "'company_payout_month',%s::uuid,date '2026-06-01')::text,0))",
                (inputs.company,),
            )

            def refresh_waiting() -> tuple[object, ...] | None:
                with psycopg.connect(
                    database_url, application_name="payout-revision-race"
                ) as worker:
                    worker.execute("set statement_timeout='10s'")
                    return worker.execute(
                        "select * from private.refresh_company_payout_reports()"
                    ).fetchone()

            future = executor.submit(refresh_waiting)
            try:
                wait_for_block(observer, "payout-revision-race", wait_event="advisory")
                observer.execute("set statement_timeout='3s'")
                # Ordinary publishers use the input guard. A controlled metadata
                # update separately exercises the captured-revision invariant.
                observer.execute(
                    "update private.payout_report_refresh_state "
                    "set requested_revision=requested_revision+1,next_attempt_at='-infinity' "
                    "where company_id=%s and month='2026-06-01'",
                    (inputs.company,),
                )
            finally:
                holder.commit()
            self.assertEqual(future.result(timeout=12), (1, 1, 0, 0))
        self.assertEqual(
            self.connection.execute(
                "select requested_revision>completed_revision "
                "from private.payout_report_refresh_state "
                "where company_id=%s and month='2026-06-01'",
                (inputs.company,),
            ).fetchone(),
            (True,),
        )
        self.assertEqual(refresh_payout_reports(self), (1, 0, 1, 0))
        self.assertEqual(refresh_payout_reports(self), (0, 0, 0, 0))
