"""Reusable day contents retain independent observations and immutable identities."""

from concurrent.futures import ThreadPoolExecutor

import psycopg
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL, require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id
from services.sync.src.source_serialization import content_sha256


class DataKioskVersionTests(SourceModelFixture):
    def test_reversed_day_order_serializes_and_rejects_stale_publication(self) -> None:
        dates = ("2026-06-15", "2026-06-16")
        first_acquisition = self.kiosk_acquisition(1, start=dates[0], end=dates[1])
        second_acquisition = self.kiosk_acquisition(2, start=dates[0], end=dates[1])
        self.connection.commit()

        def payload(acquisition: str, days: tuple[str, ...]) -> dict[str, object]:
            return {
                "id": new_id(),
                "acquisition_id": acquisition,
                "preprocess_version": "v0",
                "dataset_key": "economics",
                "days": [
                    {
                        "id": new_id(),
                        "marketplace_name": "Amazon.com",
                        "activity_date": day,
                        "expected_current_version_id": None,
                        "expected_current_batch_id": None,
                        "content_sha256": content_sha256([]),
                        "transactions": [],
                    }
                    for day in days
                ],
            }

        database_url = make_conninfo(
            DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname, hostaddr="127.0.0.1"
        )
        with (
            psycopg.connect(database_url) as winner,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            winner.execute("set statement_timeout='10s'")
            winner.execute(
                "select private.publish_data_kiosk_preprocess(%s::jsonb)",
                (Jsonb(payload(first_acquisition, dates)),),
            )

            def stale_worker() -> str:
                with psycopg.connect(database_url, application_name="stale-kiosk-worker") as worker:
                    worker.execute("set statement_timeout='10s'")
                    try:
                        worker.execute(
                            "select private.publish_data_kiosk_preprocess(%s::jsonb)",
                            (Jsonb(payload(second_acquisition, tuple(reversed(dates)))),),
                        )
                    except psycopg.errors.SerializationFailure:
                        return "stale observation rejected"
                    return "unexpected success"

            future = executor.submit(stale_worker)
            try:
                wait_for_block(observer, "stale-kiosk-worker")
            finally:
                winner.commit()
            self.assertEqual(future.result(timeout=10), "stale observation rejected")
        self.assertEqual(
            self.connection.execute(
                "select (select count(*) from private.data_kiosk_preprocess_batches),"
                "(select count(*) from private.data_kiosk_day_versions),"
                "(select count(*) from private.data_kiosk_preprocess_batch_days)"
            ).fetchone(),
            (1, 2, 2),
        )

    def test_different_processors_share_contents_and_keep_their_own_observation(self) -> None:
        component = self.component()
        day, first = self.kiosk(1, [component], version="parser-one")
        first_observation = self.kiosk_observation(first)
        _, second = self.kiosk(
            2, [component | {"id": new_id()}], expected=first, version="parser-two"
        )
        second_observation = self.kiosk_observation(second)
        self.assertEqual(first, second)
        self.assertNotEqual(first_observation, second_observation)
        self.assertEqual(
            self.connection.execute(
                "select id::text from private.data_kiosk_day_components where version_id=%s",
                (first,),
            ).fetchall(),
            [(component["id"],)],
        )
        self.assertEqual(
            self.connection.execute(
                "select b.preprocess_version,m.version_id::text "
                "from private.data_kiosk_preprocess_batch_days m "
                "join private.data_kiosk_preprocess_batches b on b.id=m.batch_id "
                "where m.day_id=%s order by b.id",
                (day,),
            ).fetchall(),
            [("parser-one", first), ("parser-two", first)],
        )
        self.assertEqual(
            self.connection.execute(
                "select m.id::text from private.data_kiosk_days d "
                "join private.data_kiosk_preprocess_batch_days m "
                "on (m.batch_id,m.day_id,m.version_id)="
                "(d.current_batch_id,d.id,d.current_version_id) where d.id=%s",
                (day,),
            ).fetchone(),
            (second_observation,),
        )
        self.connection.execute("set constraints all immediate")

    def test_stale_observation_is_rejected_even_when_version_id_has_not_changed(self) -> None:
        component = self.component()
        day, first = self.kiosk(1, [component])
        first_batch = require_row(
            self.connection.execute(
                "select current_batch_id from private.data_kiosk_days where id=%s", (day,)
            ).fetchone()
        )[0]
        _, second = self.kiosk(2, [component], expected=first)
        self.assertEqual(first, second)
        selected = self.kiosk_observation(second)
        acquisition = self.kiosk_acquisition(3)
        for expected_batch in (None, str(first_batch)):
            with (
                self.subTest(expected_batch=expected_batch),
                self.assertRaises(psycopg.errors.SerializationFailure),
                self.connection.transaction(),
            ):
                self.call(
                    "publish_data_kiosk_preprocess",
                    {
                        "id": new_id(),
                        "acquisition_id": acquisition,
                        "preprocess_version": "v0",
                        "dataset_key": "economics",
                        "days": [
                            {
                                "id": new_id(),
                                "marketplace_name": "Amazon.com",
                                "activity_date": "2026-06-15",
                                "expected_current_version_id": first,
                                "expected_current_batch_id": expected_batch,
                                "content_sha256": "a" * 64,
                                "transactions": [component],
                            }
                        ],
                    },
                )
        self.assertEqual(self.kiosk_observation(second), selected)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_preprocess_batches"
            ).fetchone(),
            (2,),
        )

    def test_day_memberships_and_current_pointers_cannot_cross_identities(self) -> None:
        first_day, first_version = self.kiosk(1, [], activity_date="2026-06-15")
        second_day, second_version = self.kiosk(1, [], activity_date="2026-06-16")
        self.assertNotEqual(first_version, second_version)
        batch = require_row(
            self.connection.execute(
                "select current_batch_id from private.data_kiosk_days where id=%s", (first_day,)
            ).fetchone()
        )[0]
        self.connection.commit()
        with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.connection.transaction():
            self.connection.execute(
                "insert into private.data_kiosk_preprocess_batch_days(batch_id,day_id,version_id) "
                "values (%s,%s,%s)",
                (batch, second_day, first_version),
            )
        with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.connection.transaction():
            self.connection.execute(
                "update private.data_kiosk_days set current_version_id=%s where id=%s",
                (second_version, first_day),
            )
            self.connection.execute("set constraints all immediate")
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute("delete from private.data_kiosk_preprocess_batch_days")
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "update private.data_kiosk_days set current_batch_id=null,current_version_id=null "
                "where id=%s",
                (first_day,),
            )
