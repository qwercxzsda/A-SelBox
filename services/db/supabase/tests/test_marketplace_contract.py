"""Text marketplace storage retains the shared labels and existing null rules."""

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from services.db.supabase.tests import test_company_terms as terms_fixture
from services.db.supabase.tests.payout_fixtures import prepare_payout
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id
from services.sync.src.amazon.marketplace_names import (
    MARKETPLACE_NAMES,
)

_SCALAR_COLUMNS = {
    "public.sku_fee_periods": True,
    "private.finances_transactions": True,
    "public.company_payout_reports": False,
}
_INVALID_LABELS = ("Unknown marketplace", "", " ", "amazon.com", " Amazon.com", "Amazon.com ")


class MarketplaceContractTests(SourceModelFixture):
    publish_terms = terms_fixture.CompanyTermsTests.publish_terms

    def test_text_columns_and_checks_match_python_labels_and_nullability(self) -> None:
        relations = list(_SCALAR_COLUMNS)
        columns = self.connection.execute(
            "select n.nspname||'.'||c.relname,a.attname,format_type(a.atttypid,a.atttypmod),"
            "a.attnotnull from pg_attribute a join pg_class c on c.oid=a.attrelid "
            "join pg_namespace n on n.oid=c.relnamespace "
            "where c.oid=any(%s::regclass[]) "
            "and a.attname='marketplace_name'",
            (relations,),
        ).fetchall()
        self.assertCountEqual(
            columns,
            [
                (relation, "marketplace_name", "marketplace_name", required)
                for relation, required in _SCALAR_COLUMNS.items()
            ],
        )
        for name in MARKETPLACE_NAMES:
            self.assertEqual(
                self.connection.execute("select %s::public.marketplace_name", (name,)).fetchone(),
                (name,),
            )

    def assert_stored_marketplace_constraints(self, relation: str) -> None:
        column = "marketplace_name"
        query = sql.SQL(
            "insert into {relation} select r.* from {relation} t, lateral "
            "jsonb_populate_record(null::{relation},to_jsonb(t)||%s::jsonb) r limit 1 "
            "returning {column}"
        ).format(relation=sql.Identifier(*relation.split(".")), column=sql.Identifier(column))
        for name in _INVALID_LABELS:
            value = name
            with (
                self.subTest(relation=relation, value=value),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(query, (Jsonb({"id": new_id(), column: value}),))
        if _SCALAR_COLUMNS[relation]:
            with (
                self.subTest(relation=relation, value=None),
                self.assertRaises(psycopg.errors.NotNullViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(query, (Jsonb({"id": new_id(), column: None}),))

    def test_publication_and_direct_storage_preserve_marketplace_boundaries(self) -> None:
        inputs = prepare_payout(self)
        payload: dict[str, object] = {
            "company_id": inputs.company,
            "marketplace_name": "Amazon.com",
            "currency": "USD",
            "start_date": "2026-06-01",
            "end_date": "2026-06-30",
            "change_reason": "Verify stored market",
        }
        self.call("publish_company_payout_report", payload | {"id": new_id()})
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_transactions where marketplace_name is null"
            ).fetchone(),
            (0,),
        )
        for relation in _SCALAR_COLUMNS:
            self.assert_stored_marketplace_constraints(relation)
        for name in _INVALID_LABELS:
            with (
                self.subTest(payout_marketplace=name),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.call(
                    "publish_company_payout_report",
                    payload | {"id": new_id(), "marketplace_name": name},
                )
        self.connection.execute("set constraints all immediate")
