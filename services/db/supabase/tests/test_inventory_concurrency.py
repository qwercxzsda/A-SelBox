"""Competing Python publications serialize before checking their expected daily capture."""

from concurrent.futures import ThreadPoolExecutor

import psycopg
from psycopg.conninfo import make_conninfo

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.inventory_fixtures import InventoryFixture
from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL
from services.sync.src.database.acquisitions import load_inventory_acquisition
from services.sync.src.database.inventory import publish_inventory_capture
from services.sync.src.inventory.models import PreparedInventory


class InventoryConcurrencyTests(InventoryFixture):
    def test_waiting_newer_observation_rejects_stale_capture_without_partial_rows(self) -> None:
        first = self.capture(self.acquire(), [self.item(quantity=1)])
        second = self.acquire(report_created_at="2026-09-29T13:00:00Z")
        third = self.acquire(report_created_at="2026-09-29T14:00:00Z")
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as winner,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            winner.execute("select 1")
            database = TransactionDatabase(winner)
            winning_id = publish_inventory_capture(
                database,
                load_inventory_acquisition(database, second),
                PreparedInventory((self.item(quantity=2),), ()),
                first,
            )

            def competing_publication() -> str | None:
                with psycopg.connect(
                    database_url, application_name="inventory-stale-worker"
                ) as worker:
                    worker.execute("set statement_timeout='10s'")
                    database = TransactionDatabase(worker)
                    try:
                        publish_inventory_capture(
                            database,
                            load_inventory_acquisition(database, third),
                            PreparedInventory((self.item(quantity=3),), ()),
                            first,
                        )
                    except psycopg.Error as error:
                        return error.sqlstate
                return None

            future = executor.submit(competing_publication)
            try:
                wait_for_block(observer, "inventory-stale-worker", wait_event="advisory")
                self.assertEqual(
                    observer.execute(
                        "select available_quantity from private.inventory_items"
                    ).fetchall(),
                    [(1,)],
                )
            finally:
                winner.commit()
            self.assertEqual(future.result(timeout=12), "40001")
            self.assertEqual(
                observer.execute(
                    "select c.id::text,i.available_quantity "
                    "from private.inventory_daily_captures c "
                    "join private.inventory_items i on i.capture_id=c.id"
                ).fetchall(),
                [(winning_id, 2)],
            )
            self.assertEqual(
                observer.execute("select count(*) from private.inventory_acquisitions").fetchone(),
                (3,),
            )
