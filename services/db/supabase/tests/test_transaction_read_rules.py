"""Shared read rules preserve financial examples and never broaden authorization."""

from decimal import Decimal
from typing import LiteralString

import psycopg

from services.db.supabase.tests import test_live_view_equivalence as live_fixture
from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture

_INLINE_HELPERS = (
    "private.settlement_fee_applicable(text,text,text)",
    "private.calculate_service_fee(numeric,numeric)",
)
_HELPERS = (
    *_INLINE_HELPERS,
    "private.validate_transaction_filters(date,date,uuid[],text[],text[],text[],text[],boolean)",
    "private.validate_page_bounds(integer,bigint)",
    "private.member_policy_covers_current_version(regclass)",
)


class TransactionReadRulesTests(SourceModelFixture):
    assign = live_fixture.LiveViewEquivalenceTests.assign

    def test_only_order_and_refund_principal_amounts_have_settlement_fees(self) -> None:
        examples = (
            (("Order", "ItemPrice", "Principal"), True),
            (("Refund", "ItemPrice", "Principal"), True),
            (("Order", "ItemPrice", "Shipping"), False),
            (("Refund", "ItemFees", "Principal"), False),
            (("Adjustment", "ItemPrice", "Principal"), False),
            ((None, "ItemPrice", "Principal"), False),
            (("Order", None, "Principal"), False),
            (("Order", "ItemPrice", None), False),
        )
        for arguments, expected in examples:
            with self.subTest(arguments=arguments):
                self.assertEqual(
                    self.connection.execute(
                        "select private.settlement_fee_applicable(%s,%s,%s) is true", arguments
                    ).fetchone(),
                    (expected,),
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

    def test_search_rules_do_not_bypass_the_rls_security_barrier(self) -> None:
        signatures = [signature for signature in _HELPERS if "search" in signature]
        rows = self.connection.execute(
            "select p.proname from pg_proc p "
            "where p.oid=any(%s::regprocedure[]) and p.proleakproof",
            (signatures,),
        ).fetchall()
        self.assertEqual(rows, [])

    def test_policy_shortcut_is_limited_to_member_fact_table_reads(self) -> None:
        company, _ = self.owner()
        query = (
            "select private.member_policy_covers_current_version("
            "'private.settlement_transactions'::regclass),"
            "private.member_policy_covers_current_version("
            "'private.data_kiosk_transactions'::regclass),"
            "private.member_policy_covers_current_version('public.seller_skus'::regclass)"
        )
        self.assertEqual(self.connection.execute(query).fetchone(), (False, False, False))
        self.assertEqual(self.as_user(self.operator(), query), [(False, False, False)])
        self.assertEqual(self.as_user(self.member(company), query), [(True, True, False)])

    def test_current_terms_keep_seller_identity_and_do_not_broaden_member_scope(self) -> None:
        first, first_sku = self.owner()
        second, second_sku = self.owner(seller="seller-two")
        self.fee(first_sku, [("2026-01-01", None, "5")])
        self.fee(second_sku, [("2026-01-01", None, "9")])
        self.assign("UNASSIGNED", None)
        query = (
            "select seller_namespace,sku,company_id::text "
            "from private.current_sku_terms order by seller_namespace,sku"
        )
        self.assertEqual(
            self.as_user(self.operator(), query),
            [
                ("seller-one", "SKU", first),
                ("seller-one", "UNASSIGNED", None),
                ("seller-two", "SKU", second),
            ],
        )
        self.assertEqual(self.as_user(self.member(first), query), [("seller-one", "SKU", first)])
        self.assertEqual(self.as_user(self.member(second), query), [("seller-two", "SKU", second)])
        self.assertEqual(self.as_user(self.auth_user(), query), [])
        row = self.connection.execute(
            "select c.reloptions,has_table_privilege('authenticated',c.oid,'SELECT'),"
            "has_table_privilege('anon',c.oid,'SELECT'),"
            "has_table_privilege('service_role',c.oid,'SELECT') "
            "from pg_class c where c.oid='private.current_sku_terms'::regclass"
        ).fetchone()
        self.assertEqual(row, (["security_invoker=true"], True, False, False))
