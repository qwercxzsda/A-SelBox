"""Source facts cross the database boundary with valid fee inputs and categories."""

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id

HISTORY_TABLES = (
    "data_kiosk_acquisitions",
    "data_kiosk_days",
    "data_kiosk_preprocess_batches",
    "data_kiosk_preprocess_versions",
    "data_kiosk_transactions",
)


class PreprocessValidationTests(SourceModelFixture):
    def test_fee_bearing_settlement_rows_require_marketplace_and_posting_date(self) -> None:
        for field, error in (
            ("marketplace_name", psycopg.errors.CheckViolation),
            ("posted_date", psycopg.errors.NotNullViolation),
        ):
            with self.subTest(field=field), self.assertRaises(error), self.connection.transaction():
                self.settlement([self.transaction("100") | {field: None}])
        self.assertEqual(
            self.connection.execute("select count(*) from private.settlements").fetchone(),
            (0,),
        )

    def test_publication_rejects_null_amount_without_replacing_current_day(self) -> None:
        _, current = self.kiosk(1, [self.component()])
        before = self.snapshot()
        for treatment in ("SETTLEMENT", "SELBOX", "DATA_KIOSK", "ANALYSIS_ONLY"):
            row = self.component(None, category=treatment)
            if treatment == "SELBOX":
                row["sku"] = None
            with (
                self.subTest(category=treatment),
                self.assertRaises(psycopg.errors.NotNullViolation),
                self.connection.transaction(),
            ):
                self.kiosk(2, [row], expected=current)
        self.assertEqual(before, self.snapshot())

    def test_direct_sql_rejects_unresolved_category_and_missing_required_inputs(self) -> None:
        self.kiosk(1, [self.component()])
        for change, error in (
            ({"category": "UNRESOLVED"}, psycopg.errors.InvalidTextRepresentation),
            ({"amount": None}, psycopg.errors.NotNullViolation),
            ({"marketplace_name": None}, psycopg.errors.NotNullViolation),
            ({"activity_date": None}, psycopg.errors.NotNullViolation),
        ):
            with (
                self.subTest(change=change),
                self.assertRaises(error),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "insert into private.data_kiosk_transactions "
                    "select r.* from private.data_kiosk_transactions t, lateral "
                    "jsonb_populate_record(null::private.data_kiosk_transactions, "
                    "to_jsonb(t) || %s::jsonb) r limit 1",
                    (Jsonb(change | {"id": new_id(), "component_key": new_id()}),),
                )

    def snapshot(self) -> dict[str, list[tuple[object, ...]]]:
        """Include current selections, raw provenance, original versions and all history."""
        return {
            table: self.connection.execute(
                sql.SQL("select to_jsonb(t) from private.{} t order by id").format(
                    sql.Identifier(table)
                )
            ).fetchall()
            for table in HISTORY_TABLES
        }
