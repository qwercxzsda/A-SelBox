"""Final unassignment and payout capture share one consistent input lock order."""

from concurrent.futures import ThreadPoolExecutor
from typing import cast

import psycopg
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL
from services.db.supabase.tests.payout_fixtures import (
    empty_report_payload,
    payout_snapshot,
    prepare_payout,
    reassign_payout_sku,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutEligibilityConcurrencyTests(SourceModelFixture):
    def test_direct_generation_waits_for_final_unassignment_then_returns_no_report(self) -> None:
        self.assert_unassignment_wins(low_level=False)

    def test_low_level_publisher_waits_for_final_unassignment_then_rejects_report(self) -> None:
        self.assert_unassignment_wins(low_level=True)

    def assert_unassignment_wins(self, *, low_level: bool) -> None:
        inputs = prepare_payout(self)
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as writer,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            source = SourceModelFixture()
            source.connection, source.seller = writer, self.seller
            reassign_payout_sku(source, inputs.sku_identity, None)

            def capture() -> object:
                with psycopg.connect(
                    database_url, application_name="eligibility-capture"
                ) as worker:
                    worker.execute("set statement_timeout='10s'")
                    try:
                        if low_level:
                            return worker.execute(
                                "select private.publish_company_payout_report(%s)",
                                (Jsonb(empty_report_payload(inputs.company)),),
                            ).fetchone()
                        return worker.execute(
                            "select * from private.generate_company_payout_reports"
                            "(%s,'2026-06-01')",
                            (inputs.company,),
                        ).fetchall()
                    except psycopg.Error as error:
                        return error.sqlstate, error.diag.message_primary

            future = executor.submit(capture)
            try:
                wait_for_block(observer, "eligibility-capture", wait_event="advisory")
                self.assertEqual(
                    observer.execute(
                        "select * from private.refresh_company_payout_reports()"
                    ).fetchone(),
                    (0, 0, 0, 0),
                )
            finally:
                writer.commit()
            result = future.result(timeout=12)
            self.assertEqual(
                result,
                ("23514", "Payout reports require at least one currently assigned SKU")
                if low_level
                else [],
            )
            self.assertEqual(
                observer.execute("select count(*) from public.company_payout_reports").fetchone(),
                (0,),
            )
            self.assertEqual(
                observer.execute(
                    "select count(*) from private.payout_report_refresh_state"
                ).fetchone(),
                (0,),
            )

    def test_final_unassignment_waits_for_capture_and_retains_that_snapshot(self) -> None:
        inputs = prepare_payout(self)
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as generator,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            generated = generator.execute(
                "select report_id::text from private.generate_company_payout_reports"
                "(%s,'2026-06-01')",
                (inputs.company,),
            ).fetchone()
            self.assertIsNotNone(generated)
            report = cast(tuple[str], generated)[0]
            saved = SourceModelFixture()
            saved.connection, saved.seller = generator, self.seller
            snapshot = payout_snapshot(saved, report)

            def unassign() -> None:
                with psycopg.connect(database_url, application_name="final-unassignment") as writer:
                    writer.execute("set statement_timeout='10s'")
                    source = SourceModelFixture()
                    source.connection, source.seller = writer, self.seller
                    reassign_payout_sku(source, inputs.sku_identity, None)

            future = executor.submit(unassign)
            try:
                wait_for_block(observer, "final-unassignment", wait_event="advisory")
            finally:
                generator.commit()
            future.result(timeout=12)
        self.assertEqual(payout_snapshot(self, report), snapshot)
        self.assertEqual(
            self.connection.execute(
                "select * from private.refresh_company_payout_reports()"
            ).fetchone(),
            (0, 0, 0, 0),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (1,),
        )
