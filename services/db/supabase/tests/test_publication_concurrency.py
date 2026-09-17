"""Competing fee publications serialize and reject a stale expected version."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid7

import psycopg
from psycopg.types.json import Jsonb

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.isolated_database import isolated_database
from services.db.supabase.tests.local_database import require_row


class PublicationConcurrencyTests(unittest.TestCase):
    def test_stale_worker_cannot_replace_a_committed_publication(self) -> None:
        with isolated_database() as database_url:
            company, owner = str(uuid7()), str(uuid7())
            with psycopg.connect(database_url) as setup:
                setup.execute(
                    "insert into public.companies(id,name) values (%s,'Concurrent Company')",
                    (company,),
                )
                first = self.publish(setup, owner, company, None)
            with (
                psycopg.connect(database_url) as winner,
                psycopg.connect(database_url, autocommit=True) as observer,
                ThreadPoolExecutor(max_workers=1) as executor,
            ):
                second = self.publish(winner, owner, company, first)

                def stale_worker() -> str:
                    with psycopg.connect(
                        database_url, application_name="stale-fee-worker"
                    ) as worker:
                        worker.execute("set statement_timeout = '10s'")
                        try:
                            self.publish(worker, owner, company, first)
                        except psycopg.errors.SerializationFailure:
                            return "stale edit rejected"
                        return "unexpected success"

                future = executor.submit(stale_worker)
                try:
                    wait_for_block(observer, "stale-fee-worker")
                finally:
                    winner.commit()
                self.assertEqual(future.result(timeout=10), "stale edit rejected")
                self.assertEqual(
                    str(
                        require_row(
                            winner.execute(
                                "select current_terms_version_id from public.seller_skus"
                            ).fetchone()
                        )[0]
                    ),
                    second,
                )
                self.assertEqual(
                    winner.execute("select count(*) from public.sku_terms_versions").fetchone(),
                    (2,),
                )

    @staticmethod
    def publish(
        connection: psycopg.Connection, owner: str, company: str, expected: str | None
    ) -> str:
        payload = {
            "id": str(uuid7()),
            "seller_sku_id": owner,
            "seller_namespace": "seller",
            "sku": "SKU",
            "company_id": company,
            "expected_current_version_id": expected,
            "change_reason": "Concurrent complete publication",
            "periods": [
                {
                    "id": str(uuid7()),
                    "marketplace_name": "Amazon.com",
                    "valid_from": "2026-01-01",
                    "valid_to": None,
                    "fee_rate_percent": "5",
                }
            ],
        }
        row = connection.execute(
            "select private.publish_sku_terms(%s::jsonb)", (Jsonb(payload),)
        ).fetchone()
        if row is None:
            raise AssertionError("Expected a database result.")
        return str(row[0])
