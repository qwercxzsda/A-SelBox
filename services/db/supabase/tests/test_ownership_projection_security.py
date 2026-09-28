"""Independent authorization regressions for the batched current-ownership projection."""

import json
from typing import LiteralString, cast

import psycopg

from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.local_database import require_row

_HELPER: LiteralString = (
    "select sku,terms_version_id::text from private.current_owned_sku_terms() order by sku"
)
_SNAPSHOT: LiteralString = """
select jsonb_build_object(
    'owned', (select coalesce(jsonb_agg(sku
        order by sku),'[]'::jsonb) from private.current_owned_sku_terms()),
    'settlement', (select count(*) from private.settlement_transactions),
    'kiosk', (select count(*) from private.data_kiosk_transactions),
    'periods', (select count(*) from public.sku_fee_periods)
)
"""


class OwnershipProjectionSecurityTests(FinancialFixture):
    def setUp(self) -> None:
        super().setUp()
        self.company_a, self.sku_a = self.owner("SHARED")
        self.fee(self.sku_a, [("2026-01-01", None, "5")])
        self.terms_a = self.fee(self.sku_a, [("2026-01-01", None, "7")])
        self.company_b, sku_b = self.owner("OTHER")
        self.terms_b = self.fee(sku_b, [("2026-01-01", None, "11")])
        self.registered_terms = self.assign("REGISTERED", self.company_a, rate="3")
        self.assign("UNASSIGNED", None, rate="9")
        self.member_a = self.member(self.company_a)
        self.member_b = self.member(self.company_b)
        self.admin = self.operator()
        self.outsider = self.auth_user()
        self.deleted = self.member(self.company_a)
        self.connection.execute("delete from auth.users where id=%s", (self.deleted,))
        self.seed_source_history()
        self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all deferred")

    def seed_source_history(self) -> None:
        acquisition = self.acquisition()
        _, old = self.settlement(
            [self.transaction("100", sku="SHARED")], acquisition_id=acquisition
        )
        self.settlement(
            [
                self.transaction("200", sku="SHARED"),
                self.transaction("300", 4, sku="SHARED", category="DATA_KIOSK"),
                self.transaction("400", 5, sku="SHARED", category="SELBOX") | {"family": None},
                self.transaction("500", 6, sku="UNASSIGNED"),
                self.transaction("600", 7, sku="IMPORT-ONLY"),
            ],
            acquisition_id=acquisition,
            expected=old,
        )
        _, old_day = self.kiosk(1, [self.component("-1", sku="SHARED")])
        self.kiosk(
            2,
            [
                self.component("-2", sku="SHARED"),
                self.component("-3", sku="SHARED", category="SETTLEMENT"),
                self.component("-4", sku="SHARED", category="ANALYSIS_ONLY"),
                self.component("-5", category="SELBOX") | {"sku": None},
                self.component("-6", sku="UNASSIGNED"),
                self.component("-7", sku="IMPORT-ONLY"),
            ],
            expected=old_day,
        )
        self.seller = "seller-two"
        self.settlement([self.transaction("700", sku="SHARED")])
        self.kiosk(1, [self.component("-8", sku="SHARED")])
        self.seller = "seller-one"

    def snapshot(self, user: str) -> dict[str, object]:
        return cast(dict[str, object], self.as_user(user, _SNAPSHOT)[0][0])

    def assert_snapshot(
        self, actual: dict[str, object], owned: list[str], counts: tuple[int, int, int]
    ) -> None:
        self.assertEqual(
            actual,
            dict(zip(("owned", "settlement", "kiosk", "periods"), (owned, *counts), strict=True)),
        )

    def test_helper_and_all_rls_surfaces_keep_exact_current_ownership(self) -> None:
        self.assertEqual(
            self.as_user(self.member_a, _HELPER),
            [
                ("REGISTERED", self.registered_terms),
                ("SHARED", self.terms_a),
            ],
        )
        self.assertEqual(self.as_user(self.member_b, _HELPER), [("OTHER", self.terms_b)])
        for user in (self.admin, self.outsider, self.deleted, ""):
            self.assertEqual(self.as_user(user, _HELPER), [])
        self.assertEqual(
            self.as_user(self.member_a, "select amount::text from private.settlement_transactions"),
            [("200",), ("700",)],
        )
        self.assertEqual(
            self.as_user(self.member_b, "select amount::text from private.settlement_transactions"),
            [],
        )
        self.assertEqual(
            self.as_user(
                self.member_a,
                "select t.amount::text from private.data_kiosk_transactions t order by t.amount",
            ),
            [("-8",), ("-4",), ("-3",), ("-2",)],
        )
        self.assertEqual(
            self.as_user(self.member_b, "select amount::text from private.data_kiosk_transactions"),
            [],
        )
        surfaces: tuple[tuple[LiteralString, tuple[int, int, int]], ...] = (
            ("select count(*) from public.skus", (2, 1, 4)),
            ("select count(*) from public.sku_terms_versions", (2, 1, 7)),
            ("select count(*) from public.sku_fee_periods", (2, 1, 5)),
            ("select count(*) from public.company_skus", (2, 1, 3)),
            ("select count(*) from public.current_sku_fee_periods", (2, 1, 3)),
            ("select count(*) from private.current_sku_terms", (2, 1, 4)),
            ("select count(*) from private.settlement_transactions", (2, 0, 7)),
            ("select count(*) from public.settlement_preprocess_entries", (2, 0, 7)),
            ("select count(*) from private.data_kiosk_transactions", (4, 0, 8)),
            ("select count(*) from public.data_kiosk_preprocess_entries", (4, 0, 8)),
        )
        for query, counts in surfaces:
            for user, expected in zip(
                (self.member_a, self.member_b, self.admin), counts, strict=True
            ):
                with self.subTest(query=query, user=user):
                    self.assertEqual(self.as_user(user, query), [(expected,)])
            for user in (self.outsider, self.deleted, ""):
                self.assertEqual(self.as_user(user, query), [(0,)])

    def execute_prepared(self, user: str) -> dict[str, object]:
        return cast(dict[str, object], self.as_user(user, "execute ownership_security")[0][0])

    def test_generic_plan_rechecks_jwt_accounts_terms_and_revocation(self) -> None:
        self.connection.execute("set local plan_cache_mode='force_generic_plan'")
        self.connection.execute("prepare ownership_security as " + _SNAPSHOT)
        initial: tuple[tuple[str, list[str], tuple[int, int, int]], ...] = (
            (self.member_a, ["REGISTERED", "SHARED"], (2, 4, 2)),
            (self.member_b, ["OTHER"], (0, 0, 1)),
            (self.admin, [], (7, 8, 5)),
            (self.outsider, [], (0, 0, 0)),
            (self.member_a, ["REGISTERED", "SHARED"], (2, 4, 2)),
        )
        for user, owned, counts in initial:
            self.assert_snapshot(self.execute_prepared(user), owned, counts)
        self.assign("SHARED", self.company_b, rate="13", expected=self.terms_a)
        self.assert_snapshot(self.execute_prepared(self.member_a), ["REGISTERED"], (0, 0, 1))
        both_skus = ["OTHER", "SHARED"]
        self.assert_snapshot(self.execute_prepared(self.member_b), both_skus, (2, 4, 2))
        self.connection.execute(
            "update public.app_accounts set company_id=%s where user_id=%s",
            (self.company_b, self.member_a),
        )
        self.assert_snapshot(self.execute_prepared(self.member_a), both_skus, (2, 4, 2))
        self.connection.execute(
            "delete from public.app_accounts where user_id=%s", (self.member_a,)
        )
        self.assert_snapshot(self.execute_prepared(self.member_a), [], (0, 0, 0))
        self.connection.execute("delete from auth.users where id=%s", (self.member_b,))
        self.assert_snapshot(self.execute_prepared(self.member_b), [], (0, 0, 0))
        self.connection.execute(
            "update public.app_accounts set access_role='company_member',company_id=%s "
            "where user_id=%s",
            (self.company_b, self.admin),
        )
        self.assert_snapshot(self.execute_prepared(self.admin), both_skus, (2, 4, 2))
        self.assert_snapshot(self.execute_prepared(""), [], (0, 0, 0))
        plans = require_row(
            self.connection.execute(
                "select generic_plans from pg_prepared_statements where name='ownership_security'"
            ).fetchone()
        )[0]
        self.assertGreaterEqual(plans, 12)

    def test_metadata_and_search_path_cannot_inject_another_account(self) -> None:
        self.connection.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (
                json.dumps(
                    {
                        "user_metadata": {"access_role": "operator", "company_id": self.company_b},
                        "app_metadata": {"access_role": "operator", "company_id": self.company_b},
                    }
                ),
            ),
        )
        self.connection.execute(
            "create temporary table app_accounts(user_id uuid,access_role text,company_id uuid)"
        )
        self.connection.execute(
            "insert into app_accounts values (%s,'operator',null)", (self.outsider,)
        )
        self.connection.execute("set local search_path=pg_temp,public,private")
        self.assert_snapshot(self.snapshot(self.member_a), ["REGISTERED", "SHARED"], (2, 4, 2))
        self.assert_snapshot(self.snapshot(self.outsider), [], (0, 0, 0))

    def test_force_rls_preserves_member_scope_and_trusted_current_reads(self) -> None:
        tables: tuple[LiteralString, ...] = (
            "alter table public.app_accounts force row level security",
            "alter table public.skus force row level security",
            "alter table public.sku_terms_versions force row level security",
            "alter table public.sku_fee_periods force row level security",
            "alter table private.settlement_transactions force row level security",
            "alter table private.data_kiosk_transactions force row level security",
        )
        for query in tables:
            self.connection.execute(query)
        self.assert_snapshot(self.snapshot(self.member_a), ["REGISTERED", "SHARED"], (2, 4, 2))
        self.connection.execute(
            "select set_config('request.jwt.claim.sub',%s,true)", (self.member_a,)
        )
        self.assertEqual(
            self.connection.execute(
                "select private.member_policy_covers_current_version("
                "'private.settlement_transactions'::regclass)"
            ).fetchone(),
            (False,),
        )
        trusted = require_row(
            self.connection.execute(
                "select public.transaction_page(p_limit=>100)->>'total_count'"
            ).fetchone()
        )[0]
        self.assertEqual(trusted, "11")
        with self.connection.transaction():
            self.connection.execute("set local row_security=off")
            self.assertEqual(len(self.as_user(self.member_a, _HELPER)), 2)
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(self.member_a, "select count(*) from public.skus")

    def test_helper_is_private_stable_and_has_no_caller_identity_argument(self) -> None:
        row = require_row(
            self.connection.execute(
                "select p.pronargs,p.prosecdef,p.provolatile::text,p.proleakproof,p.proconfig,"
                "has_function_privilege('authenticated',p.oid,'EXECUTE'),"
                "has_function_privilege('anon',p.oid,'EXECUTE'),"
                "has_function_privilege('service_role',p.oid,'EXECUTE'),"
                "exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
                "where a.grantee=0 and a.privilege_type='EXECUTE') "
                "from pg_proc p where p.oid='private.current_owned_sku_terms()'::regprocedure"
            ).fetchone()
        )
        self.assertEqual(row[:4], (0, True, "s", False))
        self.assertIn('search_path=""', row[4])
        self.assertEqual(row[5:], (True, False, False, False))
        self.assertEqual(
            self.connection.execute(
                "select pg_get_function_result('private.current_owned_sku_terms()'::regprocedure),"
                "has_schema_privilege('authenticated','private','CREATE')"
            ).fetchone(),
            (
                "TABLE(sku_id uuid, sku text, terms_version_id uuid)",
                False,
            ),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) filter(where n.nspname='private'),"
                "count(*) filter(where n.nspname='public') "
                "from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                "where p.proname='current_owned_sku_terms'"
            ).fetchone(),
            (1, 0),
        )
