"""Concurrent identical admin requests publish one immutable payout snapshot."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import cast

import psycopg
from psycopg.conninfo import make_conninfo

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL
from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    generate_payout_reports,
    payout_snapshot,
    prepare_payout,
    publish_payout,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


def generate_on_connection(
    connection: psycopg.Connection, user: str, company: str
) -> tuple[str, bool]:
    connection.execute("set statement_timeout='10s'")
    connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
    connection.execute("set local role authenticated")
    rows = connection.execute(
        "select report_id::text,created "
        "from public.generate_company_payout_reports(%s,'2026-06-01')",
        (company,),
    ).fetchall()
    connection.execute("reset role")
    if len(rows) != 1:
        raise AssertionError("Expected one monthly scope.")
    return str(rows[0][0]), cast(bool, rows[0][1])


class PayoutIdempotencyConcurrencyTests(SourceModelFixture):
    def test_competing_admin_requests_reuse_the_committed_snapshot(self) -> None:
        inputs = prepare_payout(self)
        self.assert_competing_requests_reuse(inputs.company)

    def test_competing_empty_requests_save_one_company_month_snapshot(self) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        company = new_id()
        self.connection.execute(
            "insert into public.companies(id,name) values (%s,'Empty company')", (company,)
        )
        self.assert_competing_requests_reuse(company)

    def assert_competing_requests_reuse(self, company: str) -> None:
        first_admin, second_admin = self.operator(), self.operator()
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as winner,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            first = generate_on_connection(winner, first_admin, company)
            self.assertTrue(first[1])

            def competing_request() -> tuple[str, bool]:
                with psycopg.connect(
                    database_url, application_name="matching-payout-worker"
                ) as worker:
                    return generate_on_connection(worker, second_admin, company)

            future = executor.submit(competing_request)
            try:
                wait_for_block(observer, "matching-payout-worker", wait_event="advisory")
            finally:
                winner.commit()
            self.assertEqual(future.result(timeout=12), (first[0], False))
            self.assertEqual(
                observer.execute("select count(*) from public.company_payout_reports").fetchone(),
                (1,),
            )

    def test_new_source_namespace_during_lock_wait_is_captured_by_the_next_request(self) -> None:
        self.seller = "seller-z"
        inputs = prepare_payout(self)
        operator = self.operator()
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)

        def generate_waiting_company() -> tuple[str, bool]:
            with psycopg.connect(database_url, application_name="seller-scope-a") as worker:
                return generate_on_connection(worker, operator, inputs.company)

        with (
            psycopg.connect(database_url) as holder,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            holder.execute(
                "select pg_advisory_xact_lock(hashtextextended(jsonb_build_array("
                "'company_payout_report','seller-z',date '2026-06-01')::text,0))"
            )
            future = executor.submit(generate_waiting_company)
            try:
                wait_for_block(observer, "seller-scope-a", wait_event="advisory")
                # The SKU is already assigned globally; new source provenance is
                # discovered from its matching facts, without another assignment.
                self.seller = "seller-a"
                self.settlement([self.transaction("50")])
                fill_payout_kiosk_month(self)
                self.connection.commit()
            finally:
                holder.commit()
            first_report, first_created = future.result(timeout=12)
            self.assertTrue(first_created)

        self.assertEqual(
            self.connection.execute(
                "select seller_namespace from public.company_payout_reports where id=%s",
                (first_report,),
            ).fetchone(),
            ("seller-z",),
        )
        before = payout_snapshot(self, first_report)
        results = generate_payout_reports(self, operator, inputs.company)
        self.assertEqual(len(results), 2)
        self.assertIn((first_report, False), results)
        self.assertEqual(sum(created for _, created in results), 1)
        self.assertEqual(
            self.connection.execute(
                "select seller_namespace from public.company_payout_reports "
                "where company_id=%s order by seller_namespace",
                (inputs.company,),
            ).fetchall(),
            [("seller-a",), ("seller-z",)],
        )
        self.assertEqual(payout_snapshot(self, first_report), before)

    def test_same_seller_month_serializes_different_currencies_before_day_locks(self) -> None:
        inputs = prepare_payout(self)
        self.kiosk(
            2,
            [self.component("-10"), self.component("-5") | {"currency": "EUR"}],
            expected=inputs.kiosk_version,
        )
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as winner,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            winner.execute("set statement_timeout='10s'")
            publisher = SourceModelFixture()
            publisher.connection, publisher.seller = winner, self.seller
            euro = publish_payout(publisher, inputs, currency="EUR")

            def publish_dollar() -> str:
                with psycopg.connect(
                    database_url, application_name="different-currency-payout"
                ) as worker:
                    worker.execute("set statement_timeout='10s'")
                    contender = SourceModelFixture()
                    contender.connection, contender.seller = worker, self.seller
                    return publish_payout(contender, inputs, currency="USD")

            future = executor.submit(publish_dollar)
            try:
                wait_for_block(observer, "different-currency-payout", wait_event="advisory")
                dollar = publish_payout(publisher, inputs, currency="USD")
            finally:
                winner.commit()
            self.assertEqual(future.result(timeout=12), dollar)
            self.assertNotEqual(euro, dollar)
            self.assertEqual(
                observer.execute(
                    "select currency,count(*) from public.company_payout_reports group by currency "
                    "order by currency"
                ).fetchall(),
                [("EUR", 1), ("USD", 1)],
            )

    def test_latest_order_uses_save_time_when_transaction_started_before_prior_report(self) -> None:
        inputs = prepare_payout(self)
        operator = self.operator()
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with psycopg.connect(database_url) as older_transaction:
            older_transaction.execute("select now()")
            first = generate_on_connection(self.connection, operator, inputs.company)
            self.assertTrue(first[1])
            self.connection.commit()
            self.fee(inputs.sku_identity, [("2026-01-01", None, "5")])
            self.connection.commit()
            second = generate_on_connection(older_transaction, operator, inputs.company)
            self.assertTrue(second[1])
            self.assertNotEqual(first[0], second[0])
            older_transaction.commit()
        self.assertEqual(
            self.connection.execute(
                "select newer.created_at > older.created_at "
                "from public.company_payout_reports newer,public.company_payout_reports older "
                "where newer.id=%s and older.id=%s",
                (second[0], first[0]),
            ).fetchone(),
            (True,),
        )
        self.assertEqual(
            generate_on_connection(self.connection, operator, inputs.company), (second[0], False)
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (2,),
        )
