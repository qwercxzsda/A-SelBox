"""Shared read rules preserve financial examples and never broaden authorization."""

from decimal import Decimal
from typing import LiteralString

import psycopg

from services.db.supabase.tests import test_live_view_equivalence as live_fixture
from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture

_INLINE_HELPERS = (
    "private.calculate_service_fee(numeric,numeric)",
    "private.reconcile_source_amounts(numeric,numeric,numeric,numeric)",
)
_HELPERS = (
    *_INLINE_HELPERS,
    "private.mature_cutoff_date()",
    "private.reconciliation_group_id(text,date,text,text)",
    "private.financial_account_visible()",
    "private.resolve_source_reconciliation(uuid[],uuid[])",
    "private.validate_transaction_filters(date,date,uuid[],text[],text[],text[],text[],boolean)",
    "private.validate_page_bounds(integer,bigint)",
    "private.member_policy_covers_current_version(regclass)",
)


class TransactionReadRulesTests(SourceModelFixture):
    assign = live_fixture.LiveViewEquivalenceTests.assign

    def test_only_sale_and_refund_principal_components_have_finances_fee_bases(self) -> None:
        self.finances(
            [
                self.transaction("100"),
                self.transaction("-20", kind="Refund"),
                self.transaction("5", description="Shipping"),
            ]
        )
        self.assertCountEqual(
            self.connection.execute(
                "select component_type,fee_base from public.finances_preprocess_entries "
                "where is_current"
            ).fetchall(),
            [
                ("PRODUCT_SALES", Decimal(100)),
                ("PRODUCT_REFUNDS", Decimal(-20)),
                ("Shipment/Shipping", None),
            ],
        )

    def test_service_fee_sign_zero_null_and_precision_examples(self) -> None:
        examples = (
            ("100", "5", "-5"),
            ("-25", "5", "1.25"),
            ("0", "5", "0"),
            ("100", "0", "0"),
            ("100.123456789012345678901", "5.125", "-5.13132716043688271604367625"),
            ("0", None, None),
            ("100", None, None),
            (None, "5", None),
        )
        for base, rate, expected in examples:
            with self.subTest(base=base, rate=rate):
                self.assertEqual(
                    self.connection.execute(
                        "select private.calculate_service_fee(%s::numeric,%s::numeric)",
                        (base, rate),
                    ).fetchone(),
                    (Decimal(expected) if expected is not None else None,),
                )

    def test_shared_validation_preserves_invalid_parameter_errors(self) -> None:
        queries: tuple[LiteralString, ...] = (
            "select private.validate_page_bounds(0,0)",
            "select private.validate_page_bounds(1001,0)",
            "select private.validate_page_bounds(25,-1)",
            "select private.validate_page_bounds(25,9007199254740992)",
            "select private.validate_transaction_filters('2026-06-02','2026-06-01',null,null,null)",
            "select private.validate_transaction_filters('infinity',null,null,null,null)",
            "select private.validate_transaction_filters(null,null,null,array[null],null)",
            "select private.validate_transaction_filters(null,null,null,array[['a'],['b']],null)",
            "select private.validate_transaction_filters(null,null,null,null,null,null,null,true)",
        )
        for query in queries:
            with (
                self.subTest(query=query),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
                self.connection.transaction(),
            ):
                self.connection.execute(query)

    def test_helpers_are_private_invoker_functions_with_narrow_grants(self) -> None:
        for signature in _HELPERS:
            with self.subTest(signature=signature):
                row = require_row(
                    self.connection.execute(
                        "select p.prosecdef,p.provolatile::text,p.proparallel::text,p.proconfig,"
                        "has_function_privilege('authenticated',p.oid,'EXECUTE'),"
                        "has_function_privilege('anon',p.oid,'EXECUTE'),"
                        "has_function_privilege('service_role',p.oid,'EXECUTE'),"
                        "exists(select 1 from "
                        "aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
                        "where a.grantee=0 and a.privilege_type='EXECUTE') "
                        "from pg_proc p where p.oid=%s::regprocedure",
                        (signature,),
                    ).fetchone()
                )
                self.assertFalse(row[0])
                self.assertEqual(row[4:], (True, False, False, False))
                if signature in _INLINE_HELPERS:
                    self.assertEqual(row[1:4], ("i", "s", None))
                else:
                    self.assertIn('search_path=""', row[3])

    def test_read_helpers_do_not_bypass_the_rls_security_barrier(self) -> None:
        rows = self.connection.execute(
            "select p.proname from pg_proc p "
            "where p.oid=any(%s::regprocedure[]) and p.proleakproof",
            (list(_HELPERS),),
        ).fetchall()
        self.assertEqual(rows, [])

    def test_policy_shortcut_is_limited_to_member_fact_table_reads(self) -> None:
        company, _ = self.owner()
        query = (
            "select private.member_policy_covers_current_version("
            "'private.finances_transaction_components'::regclass),"
            "private.member_policy_covers_current_version("
            "'private.data_kiosk_day_components'::regclass),"
            "private.member_policy_covers_current_version('public.skus'::regclass)"
        )
        self.assertEqual(self.connection.execute(query).fetchone(), (False, False, False))
        self.assertEqual(self.as_user(self.administrator(), query), [(False, False, False)])
        self.assertEqual(self.as_user(self.member(company), query), [(True, True, False)])

    def test_current_terms_use_exact_sku_identity_and_do_not_broaden_member_scope(self) -> None:
        first, first_sku = self.owner()
        second, second_sku = self.owner("SKU ")
        self.fee(first_sku, [("2026-01-01", None, "5")])
        self.fee(second_sku, [("2026-01-01", None, "9")])
        self.assign("UNASSIGNED", None)
        query = "select sku,company_id::text from private.current_sku_terms order by sku"
        self.assertEqual(
            self.as_user(self.administrator(), query),
            [
                ("SKU", first),
                ("SKU ", second),
                ("UNASSIGNED", None),
            ],
        )
        self.assertEqual(self.as_user(self.member(first), query), [("SKU", first)])
        self.assertEqual(self.as_user(self.member(second), query), [("SKU ", second)])
        self.assertEqual(self.as_user(self.auth_user(), query), [])
        row = self.connection.execute(
            "select c.reloptions,has_table_privilege('authenticated',c.oid,'SELECT'),"
            "has_table_privilege('anon',c.oid,'SELECT'),"
            "has_table_privilege('service_role',c.oid,'SELECT') "
            "from pg_class c where c.oid='private.current_sku_terms'::regclass"
        ).fetchone()
        self.assertEqual(row, (["security_invoker=true"], True, False, False))
