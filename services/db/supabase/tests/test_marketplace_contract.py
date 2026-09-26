"""Text marketplace storage retains the shared labels and existing null rules."""

import re

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from services.db.supabase.tests import test_company_terms as terms_fixture
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id
from services.sync.src.amazon.marketplace_names import MARKETPLACE_NAMES, validate_marketplace_name

_SCALAR_COLUMNS = {
    "public.sku_fee_periods": True,
    "private.settlement_transactions": False,
    "private.data_kiosk_days": True,
    "private.data_kiosk_transactions": True,
    "public.company_payout_report_components": False,
}
_REPORTS = "public.company_payout_reports"
_INVALID_LABELS = ("Unknown marketplace", "", " ", "amazon.com", " Amazon.com", "Amazon.com ")


class MarketplaceContractTests(SourceModelFixture):
    publish_terms = terms_fixture.CompanyTermsTests.publish_terms

    def test_text_columns_and_checks_match_python_labels_and_nullability(self) -> None:
        relations = [*_SCALAR_COLUMNS, _REPORTS]
        columns = self.connection.execute(
            "select n.nspname||'.'||c.relname,a.attname,format_type(a.atttypid,a.atttypmod),"
            "a.attnotnull from pg_attribute a join pg_class c on c.oid=a.attrelid "
            "join pg_namespace n on n.oid=c.relnamespace "
            "where c.oid=any(%s::regclass[]) "
            "and a.attname in ('marketplace_name','marketplace_names')",
            (relations,),
        ).fetchall()
        self.assertCountEqual(
            columns,
            [
                (relation, "marketplace_name", "text", required)
                for relation, required in _SCALAR_COLUMNS.items()
            ]
            + [(_REPORTS, "marketplace_names", "text[]", True)],
        )
        for relation in relations:
            checks = self.connection.execute(
                "select pg_get_expr(c.conbin,c.conrelid) from pg_constraint c "
                "join pg_attribute a on a.attrelid=c.conrelid and c.conkey=array[a.attnum] "
                "where c.conrelid=%s::regclass and c.contype='c' "
                "and a.attname in ('marketplace_name','marketplace_names')",
                (relation,),
            ).fetchall()
            labels = {
                label.replace("''", "'")
                for (expression,) in checks
                for label in re.findall(r"'((?:[^']|'')*)'::text", expression)
            }
            with self.subTest(relation=relation):
                self.assertEqual(labels, MARKETPLACE_NAMES)

    def publish_marketplace_report(self) -> dict[str, object]:
        company, sku = self.owner()
        self.publish_terms(
            sku,
            company,
            [terms_fixture.CompanyTermsTests.period(name) for name in MARKETPLACE_NAMES],
        )
        settlement, _ = self.settlement(
            [
                self.transaction("1", line) | {"marketplace_name": name}
                for line, name in enumerate(sorted(MARKETPLACE_NAMES), 3)
            ]
            + [self.transaction("2", 100, kind="Adjustment") | {"marketplace_name": None}]
        )
        self.kiosk(1, [self.component()])
        payload: dict[str, object] = {
            "id": new_id(),
            "company_id": company,
            "seller_namespace": self.seller,
            "currency": "USD",
            "start_date": "2026-06-15",
            "end_date": "2026-06-15",
            "preprocess_version": "v0",
            "settlement_ids": [settlement],
            "marketplace_names": ["Amazon.com"],
            "dataset_key": "economics",
            "report_name": "Marketplace constraints",
            "change_reason": "Exercise nullable source and saved component marketplaces",
        }
        self.call("publish_company_payout_report", payload)
        return payload

    def assert_stored_marketplace_constraints(self, relation: str) -> None:
        column = "marketplace_names" if relation == _REPORTS else "marketplace_name"
        query = sql.SQL(
            "insert into {relation} select r.* from {relation} t, lateral "
            "jsonb_populate_record(null::{relation},to_jsonb(t)||%s::jsonb) r limit 1 "
            "returning {column}"
        ).format(relation=sql.Identifier(*relation.split(".")), column=sql.Identifier(column))
        for name in _INVALID_LABELS:
            value = [name] if relation == _REPORTS else name
            with (
                self.subTest(relation=relation, value=value),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(query, (Jsonb({"id": new_id(), column: value}),))
        if _SCALAR_COLUMNS.get(relation, True):
            with (
                self.subTest(relation=relation, value=None),
                self.assertRaises(psycopg.errors.NotNullViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(query, (Jsonb({"id": new_id(), column: None}),))
        if relation == _REPORTS:
            for values in ([None], ["Amazon.com", None]):
                with (
                    self.subTest(values=values),
                    self.assertRaises(psycopg.errors.CheckViolation),
                    self.connection.transaction(),
                ):
                    self.connection.execute(query, (Jsonb({"id": new_id(), column: values}),))
            for values in ([], sorted(MARKETPLACE_NAMES)):
                with self.subTest(values=values), self.connection.transaction(force_rollback=True):
                    self.assertEqual(
                        self.connection.execute(
                            query, (Jsonb({"id": new_id(), column: values}),)
                        ).fetchone(),
                        (values,),
                    )

    def test_publication_and_direct_storage_preserve_marketplace_boundaries(self) -> None:
        payload = self.publish_marketplace_report()
        for relation in (
            "private.settlement_transactions",
            "public.company_payout_report_components",
        ):
            self.assertEqual(
                self.connection.execute(
                    sql.SQL("select count(*) from {} where marketplace_name is null").format(
                        sql.Identifier(*relation.split("."))
                    )
                ).fetchone(),
                (1,),
            )
        for relation in (*_SCALAR_COLUMNS, _REPORTS):
            self.assert_stored_marketplace_constraints(relation)
        for names in ([None], ["Amazon.com", None], *([name] for name in _INVALID_LABELS)):
            with (
                self.subTest(payout_marketplaces=names),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.call(
                    "publish_company_payout_report",
                    payload | {"id": new_id(), "marketplace_names": names},
                )
        self.connection.execute("set constraints all immediate")

    def test_text_rpc_filters_keep_supported_labels_and_array_validation(self) -> None:
        operator = self.operator()
        query = "select public.transaction_count(p_marketplaces=>%s::text[])"
        for names in (None, [], sorted(MARKETPLACE_NAMES)):
            self.assertEqual(self.as_user(operator, query, (names,)), [("0",)])
        for name in MARKETPLACE_NAMES:
            self.assertEqual(validate_marketplace_name(name), name)
        for name in _INVALID_LABELS:
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_marketplace_name(name)
            with (
                self.subTest(financial_marketplace=name),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.totals([], marketplaces=[name])
        for names in (
            [None],
            ["Amazon.com", None],
            [["Amazon.com"]],
            *([name] for name in _INVALID_LABELS),
        ):
            with self.subTest(names=names), self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.as_user(operator, query, (names,))

    def test_optional_kiosk_fact_marketplaces_keep_publication_validation(self) -> None:
        _, current = self.kiosk(1, [self.component() | {"marketplace_name": "Amazon.ca"}])
        _, current = self.kiosk(
            2, [self.component() | {"marketplace_name": None}], expected=current
        )
        self.assertEqual(
            self.connection.execute(
                "select distinct marketplace_name from private.data_kiosk_transactions"
            ).fetchall(),
            [("Amazon.com",)],
        )
        invalid_values: tuple[object, ...] = (*_INVALID_LABELS, 1, True, {}, [])
        for name in invalid_values:
            with (
                self.subTest(name=name),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.kiosk(3, [self.component() | {"marketplace_name": name}], expected=current)
        self.assertEqual(
            self.connection.execute(
                "select current_version_id::text from private.data_kiosk_days"
            ).fetchall(),
            [(current,)],
        )
