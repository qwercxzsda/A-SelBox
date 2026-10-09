"""Company row locks serialize deletion against references and competing retries."""

import json
from concurrent.futures import ThreadPoolExecutor

import psycopg
from psycopg.conninfo import make_conninfo

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id

_DELETE = "select id::text,deleted from public.delete_company(%s)"


class CompanyDeletionConcurrencyTests(SourceModelFixture):
    def setUp(self) -> None:
        super().setUp()
        self.administrator_id = self.administrator()
        self.company = new_id()
        self.connection.execute(
            "insert into public.companies(id,name) values (%s,'Concurrent company')",
            (self.company,),
        )
        self.connection.commit()
        self.database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)

    def competing_delete(self) -> tuple[object, ...] | None:
        with psycopg.connect(self.database_url, application_name="company-deletion") as worker:
            worker.execute("set statement_timeout='10s'")
            worker.execute(
                "select set_config('request.jwt.claim.sub',%s,true)", (self.administrator_id,)
            )
            worker.execute("set local role authenticated")
            try:
                return worker.execute(_DELETE, (self.company,)).fetchone()
            except psycopg.Error as error:
                return error.sqlstate, json.loads(error.diag.message_detail or "null")

    def test_deletion_waits_for_new_reference_then_reports_it_without_cascading(self) -> None:
        self.connection.execute(
            "insert into private.payout_report_refresh_state(company_id,month) "
            "values (%s,'2026-06-01')",
            (self.company,),
        )
        with (
            psycopg.connect(self.database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            future = executor.submit(self.competing_delete)
            try:
                wait_for_block(observer, "company-deletion")
            finally:
                self.connection.commit()
            self.assertEqual(
                future.result(timeout=12), ("PT409", [{"code": "payout_refreshes", "count": 1}])
            )
            self.assertEqual(
                observer.execute(
                    "select count(*) from private.payout_report_refresh_state where company_id=%s",
                    (self.company,),
                ).fetchone(),
                (1,),
            )

    def test_new_reference_waits_for_deletion_then_fails_its_foreign_key(self) -> None:
        self.connection.execute("select 1")
        self.assertEqual(
            self.as_user(self.administrator_id, _DELETE, (self.company,)), [(self.company, True)]
        )
        with (
            psycopg.connect(self.database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):

            def add_reference() -> str | None:
                with psycopg.connect(
                    self.database_url, application_name="company-reference"
                ) as worker:
                    worker.execute("set statement_timeout='10s'")
                    try:
                        worker.execute(
                            "insert into private.payout_report_refresh_state(company_id,month) "
                            "values (%s,'2026-06-01')",
                            (self.company,),
                        )
                    except psycopg.Error as error:
                        return error.sqlstate
                return None

            future = executor.submit(add_reference)
            try:
                wait_for_block(observer, "company-reference")
            finally:
                self.connection.commit()
            self.assertEqual(future.result(timeout=12), "23503")
            self.assertEqual(
                observer.execute("select count(*) from public.companies").fetchone(), (0,)
            )
            self.assertEqual(
                observer.execute(
                    "select count(*) from private.payout_report_refresh_state"
                ).fetchone(),
                (0,),
            )

    def test_concurrent_duplicate_deletion_is_a_safe_noop(self) -> None:
        self.connection.execute("select 1")
        self.assertEqual(
            self.as_user(self.administrator_id, _DELETE, (self.company,)), [(self.company, True)]
        )
        with (
            psycopg.connect(self.database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            future = executor.submit(self.competing_delete)
            try:
                wait_for_block(observer, "company-deletion")
            finally:
                self.connection.commit()
            self.assertEqual(future.result(timeout=12), (self.company, False))
