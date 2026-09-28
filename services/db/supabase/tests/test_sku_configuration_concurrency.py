"""Concurrent complete-configuration saves serialize and retain atomic CAS behavior."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from typing import cast

import psycopg
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.configuration_fixtures import (
    ConfigurationFixture,
    ConfigurationPublication,
)
from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL, require_row


def save_configuration(
    connection: psycopg.Connection, user: str, changes: list[dict[str, object]]
) -> ConfigurationPublication:
    connection.execute("set statement_timeout='10s'")
    connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
    connection.execute("set local role authenticated")
    result = require_row(
        connection.execute(
            "select public.publish_sku_configuration(%s::jsonb,'Concurrent complete edit')",
            (Jsonb(changes),),
        ).fetchone()
    )[0]
    connection.execute("reset role")
    return cast(ConfigurationPublication, result)


class SkuConfigurationConcurrencyTests(ConfigurationFixture):
    def test_competing_reversed_batches_wait_then_reject_stale_versions_without_partial_history(
        self,
    ) -> None:
        company, _ = self.owner("A")
        self.assign("B", company)
        operator = self.operator()
        changes = [
            self.change("B", company, [self.period("8")]),
            self.change("A", company, [self.period("7")]),
        ]
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as winner,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            published = save_configuration(winner, operator, changes)
            self.assertEqual(published["changed_count"], 2)

            def competing_save() -> tuple[str | None, str | None]:
                with psycopg.connect(
                    database_url, application_name="configuration-stale-worker"
                ) as worker:
                    try:
                        save_configuration(worker, operator, list(reversed(changes)))
                    except psycopg.Error as error:
                        return error.sqlstate, error.diag.message_primary
                return None, None

            future = executor.submit(competing_save)
            try:
                wait_for_block(observer, "configuration-stale-worker", wait_event="advisory")
            finally:
                winner.commit()
            self.assertEqual(
                future.result(timeout=12), ("PT409", "SKU configuration changed while editing")
            )
            self.assertEqual(
                observer.execute("select count(*) from public.sku_terms_versions").fetchone(), (4,)
            )
            self.assertEqual(
                observer.execute(
                    "select s.sku,p.fee_rate_percent from public.skus s "
                    "join public.sku_fee_periods p on p.terms_version_id=s.current_terms_version_id order by s.sku"
                ).fetchall(),
                [("A", Decimal(7)), ("B", Decimal(8))],
            )
