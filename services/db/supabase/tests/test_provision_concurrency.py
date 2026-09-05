"""Provision and fee concurrency checks in a disposable database on the guarded local server."""

import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from dataclasses import replace
from datetime import UTC, datetime
from itertools import product
from pathlib import Path
from time import monotonic, sleep
from typing import cast
from uuid import uuid4

import psycopg
from psycopg import sql

from services.db.supabase.tests.local_database import (
    DEFAULT_DATABASE_URL,
    assert_migrated_local_schema,
    read_trusted_sql,
    require_local_supabase_url,
)
from services.sync.src.database.data_kiosk_economics.models import DataKioskProvisionRefresh
from services.sync.src.database.data_kiosk_economics.repository import (
    ProvisionCursor,
    persist_data_kiosk_provisions_with_cursor,
)
from services.sync.tests.support.economics import complete_economics_fact

_MARKETPLACE_ID = "ATVPDKIKX0DER"


@unittest.skipUnless(
    os.environ.get("RUN_LOCAL_SUPABASE_TESTS") == "1",
    "Set RUN_LOCAL_SUPABASE_TESTS=1 to run disposable local database checks.",
)
class TestProvisionConcurrency(unittest.TestCase):
    database_name: str

    @classmethod
    def setUpClass(cls) -> None:
        require_local_supabase_url(DEFAULT_DATABASE_URL)
        cls.database_name = f"provision_c1_test_{uuid4().hex}"
        with psycopg.connect(DEFAULT_DATABASE_URL, autocommit=True) as admin:
            assert_migrated_local_schema(admin)
            admin.execute(sql.SQL("create database {}").format(sql.Identifier(cls.database_name)))
        cls.addClassCleanup(cls._drop_database)
        migrations = Path(__file__).parents[1] / "migrations"
        with cls._connect() as connection:
            connection.execute("create schema extensions")
            connection.execute(
                read_trusted_sql(migrations / "20260904092515_create_workflow_data_model.sql")
            )
            connection.execute(
                """
                insert into private.data_kiosk_provisions (
                    seller_namespace, amazon_scope, marketplace_id, activity_date,
                    sku, currency, units_sold, units_returned, net_units_sold,
                    product_sales, product_refunds, net_product_sales,
                    amazon_fee_total, advertising_total, selbox_fee_base, selbox_fee,
                    refreshed_at
                ) values (
                    'migration-backfill', 'NA', 'ATVPDKIKX0DER', '2026-08-01',
                    'SKU-1', 'USD', 1, 0, 1, 1e-1500, 0, 1e-1500, 0, 0, 1e-1500, 0,
                    '2026-09-01 00:00:00+00'
                )
                """
            )
            before = connection.execute(
                "select to_jsonb(provision)::text from private.data_kiosk_provisions as provision"
            ).fetchone()
            connection.execute(
                read_trusted_sql(migrations / "20260905064419_provision_processing_logs.sql")
            )
            for migration in sorted(migrations.glob("*.sql")):
                if migration.name > "20260905064419_provision_processing_logs.sql":
                    connection.execute(read_trusted_sql(migration))
            after = connection.execute(
                "select (to_jsonb(provision) - 'id' - 'processing_log_id')::text "
                "from private.latest_data_kiosk_provisions as provision"
            ).fetchone()
            if before != after:
                raise AssertionError("The provision migration changed existing facts.")

    @classmethod
    def _connect(cls, *, autocommit: bool = False) -> psycopg.Connection[tuple[object, ...]]:
        # Only the generated database name is overridden after guarding the local server.
        return psycopg.connect(
            DEFAULT_DATABASE_URL,
            dbname=cls.database_name,
            autocommit=autocommit,
            connect_timeout=5,
            options="-c statement_timeout=5000 -c lock_timeout=2000",
        )

    @classmethod
    def _drop_database(cls) -> None:
        with psycopg.connect(DEFAULT_DATABASE_URL, autocommit=True) as admin:
            admin.execute(sql.SQL("drop database {}").format(sql.Identifier(cls.database_name)))

    def test_concurrent_batches_publish_atomically_in_either_commit_order(self) -> None:
        for reverse_commit, empty_newer in product((False, True), repeat=2):
            with (
                self.subTest(reverse_commit=reverse_commit, empty_newer=empty_newer),
                ExitStack() as stack,
            ):
                first = stack.enter_context(self._connect())
                second = stack.enter_context(self._connect())
                reader = stack.enter_context(self._connect(autocommit=True))
                seller = f"concurrent-{uuid4()}"
                company_id = uuid4()
                reader.execute(
                    "insert into public.companies (id, company_name) values (%s, %s)",
                    (company_id, f"Provision Test Company {company_id}"),
                )
                reader.execute(
                    """
                    insert into public.company_sku_fee_rates (
                        seller_namespace, marketplace_id, sku, company_id,
                        fee_rate_percent, valid_period
                    )
                    select %s, %s, sku, %s, 0, '[2026-01-01,)'::daterange
                    from unnest(array['SKU-1', 'SKU-2']) as fee_sku(sku)
                    """,
                    (seller, _MARKETPLACE_ID, company_id),
                )
                refresh = DataKioskProvisionRefresh(
                    seller_namespace=seller,
                    amazon_scope="NA",
                    marketplace_ids=(_MARKETPLACE_ID,),
                    facts=(complete_economics_fact(),),
                    refreshed_at=datetime(2026, 9, 5, tzinfo=UTC),
                )
                with first.cursor() as cursor:
                    first_result = persist_data_kiosk_provisions_with_cursor(
                        cast(ProvisionCursor, cursor), refresh
                    )
                with second.cursor() as cursor:
                    second_result = persist_data_kiosk_provisions_with_cursor(
                        cast(ProvisionCursor, cursor),
                        replace(
                            refresh,
                            facts=(
                                () if empty_newer else (replace(refresh.facts[0], msku="SKU-2"),)
                            ),
                        ),
                    )

                def current_skus(
                    connection: psycopg.Connection[tuple[object, ...]] = reader,
                    seller_namespace: str = seller,
                ) -> list[tuple[object, ...]]:
                    return connection.execute(
                        "select sku from private.latest_data_kiosk_provisions "
                        "where seller_namespace = %s order by sku",
                        (seller_namespace,),
                    ).fetchall()

                self.assertEqual(current_skus(), [])
                self.assertEqual(
                    reader.execute(
                        "select count(*) from private.data_kiosk_provision_processing_logs "
                        "where seller_namespace = %s",
                        (seller,),
                    ).fetchone(),
                    (0,),
                )
                expected_current = [] if empty_newer else [("SKU-2",)]
                if reverse_commit:
                    second.commit()
                    self.assertEqual(current_skus(), expected_current)
                    # An uncommitted older batch is invisible to cleanup. It may
                    # survive until the next cleanup, but cannot replace the newer batch.
                    self.assertEqual(
                        reader.execute(
                            "select private.prune_data_kiosk_provision_results(%s, 'NA', 1)",
                            (seller,),
                        ).fetchone(),
                        (0,),
                    )
                    first.commit()
                else:
                    first.commit()
                    self.assertEqual(current_skus(), [("SKU-1",)])
                    second.commit()
                self.assertEqual(current_skus(), expected_current)
                self.assertEqual(
                    reader.execute(
                        "select count(*) from private.data_kiosk_provisions "
                        "where seller_namespace = %s",
                        (seller,),
                    ).fetchone(),
                    (1 if empty_newer else 2,),
                )
                self.assertEqual(
                    reader.execute(
                        "select private.prune_data_kiosk_provision_results(%s, 'NA', 1)",
                        (seller,),
                    ).fetchone(),
                    (1,),
                )
                self.assertEqual(current_skus(), expected_current)
                self.assertEqual(
                    reader.execute(
                        "select id::text from private.data_kiosk_provision_processing_logs "
                        "where seller_namespace = %s order by processed_at, id",
                        (seller,),
                    ).fetchall(),
                    [
                        (first_result.processing_log_id,),
                        (second_result.processing_log_id,),
                    ],
                )

    def test_committed_log_rejects_later_appends(self) -> None:
        with self._connect() as connection:
            row = connection.execute(
                "select id from private.data_kiosk_provisions "
                "where seller_namespace = 'migration-backfill'"
            ).fetchone()
            if row is None:
                self.fail("The migrated provision was not retained.")
            with (
                self.assertRaisesRegex(psycopg.errors.RaiseException, "with their processing log"),
                connection.transaction(),
            ):
                connection.execute(
                    """
                        insert into private.data_kiosk_provisions (
                            processing_log_id, seller_namespace, amazon_scope, marketplace_id,
                            activity_date, sku, currency, units_sold, units_returned,
                            net_units_sold,
                            product_sales, product_refunds, net_product_sales, amazon_fee_total,
                            advertising_total, selbox_fee_base, selbox_fee, refreshed_at
                        )
                        select processing_log_id, seller_namespace, amazon_scope, marketplace_id,
                            activity_date, 'LATE-SKU', currency, units_sold, units_returned,
                            net_units_sold, product_sales, product_refunds, net_product_sales,
                            amazon_fee_total, advertising_total, selbox_fee_base, selbox_fee,
                            refreshed_at
                        from private.data_kiosk_provisions as provision where id = %s
                        """,
                    (row[0],),
                )

    def test_concurrent_fee_inserts_check_after_waiting_for_the_same_sku(self) -> None:
        insert_fee_sql = """
            insert into public.company_sku_fee_rates (
                seller_namespace, marketplace_id, sku, company_id,
                fee_rate_percent, valid_period, created_at
            ) values (%s, 'TEST', 'SKU', %s, 2.5, %s::daterange, %s::timestamptz)
            returning id
        """
        for different_company in (True, False):
            with self.subTest(different_company=different_company), ExitStack() as stack:
                first = stack.enter_context(self._connect())
                second = stack.enter_context(self._connect())
                reader = stack.enter_context(self._connect(autocommit=True))
                companies = (uuid4(), uuid4())
                reader.execute(
                    "insert into public.companies (id, company_name) values (%s, %s), (%s, %s)",
                    (companies[0], str(companies[0]), companies[1], str(companies[1])),
                )
                seller = f"fee-concurrent-{uuid4()}"
                first.execute(
                    insert_fee_sql,
                    (seller, companies[0], "[2026-01-01,)", "2026-08-01 00:00:00+00"),
                )
                second.execute("set local lock_timeout = '5s'")
                with ThreadPoolExecutor(max_workers=1) as executor:
                    pending = executor.submit(
                        second.execute,
                        insert_fee_sql,
                        (
                            seller,
                            companies[1] if different_company else companies[0],
                            "[2026-04-01,2026-05-01)",
                            "2026-08-02 00:00:00+00",
                        ),
                    )
                    deadline = monotonic() + 2
                    waiting = False
                    try:
                        while monotonic() < deadline and not pending.done():
                            waiting = reader.execute(
                                "select wait_event = 'advisory' "
                                "from pg_stat_activity where pid = %s",
                                (second.info.backend_pid,),
                            ).fetchone() == (True,)
                            if waiting:
                                break
                            sleep(0.01)
                    finally:
                        first.commit()
                    self.assertTrue(waiting, "The competing fee insert must wait for the SKU lock.")
                    if different_company:
                        with self.assertRaises(psycopg.errors.ExclusionViolation):
                            pending.result(timeout=5)
                        second.rollback()
                    else:
                        pending.result(timeout=5)
                        second.commit()
                self.assertEqual(
                    reader.execute(
                        "select count(*) from private.latest_company_sku_fee_rates "
                        "where seller_namespace = %s and valid_period @> '2026-02-01'::date",
                        (seller,),
                    ).fetchone(),
                    (1 if different_company else 0,),
                )

    def test_fee_inserts_reject_isolation_without_fresh_snapshots(self) -> None:
        for isolation in (
            psycopg.IsolationLevel.REPEATABLE_READ,
            psycopg.IsolationLevel.SERIALIZABLE,
        ):
            with self.subTest(isolation=isolation), self._connect() as connection:
                connection.isolation_level = isolation
                with self.assertRaisesRegex(
                    psycopg.errors.InvalidTransactionState, "READ COMMITTED"
                ):
                    connection.execute(
                        """
                        insert into public.company_sku_fee_rates (
                            seller_namespace, marketplace_id, sku, company_id,
                            fee_rate_percent, valid_period
                        ) values ('isolation-test', 'TEST', 'SKU', %s, 2.5, '[2026-01-01,)')
                        """,
                        (uuid4(),),
                    )
                connection.rollback()


if __name__ == "__main__":
    unittest.main()
