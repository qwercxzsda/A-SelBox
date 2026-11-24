"""Independent authorization regressions for the batched current-ownership projection."""

from typing import LiteralString, cast

from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.local_database import require_row

_HELPER: LiteralString = (
    "select sku,terms_version_id::text from private.current_owned_sku_terms() order by sku"
)
_SNAPSHOT: LiteralString = """
select jsonb_build_object(
    'owned', (select coalesce(jsonb_agg(sku
        order by sku),'[]'::jsonb) from private.current_owned_sku_terms()),
    'finances', (select count(*) from private.finances_amounts),
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
        self.admin = self.administrator()
        self.outsider = self.auth_user()
        self.deleted = self.member(self.company_a)
        self.connection.execute("delete from auth.users where id=%s", (self.deleted,))
        self.finances([self.transaction("5", sku="SHARED"), self.transaction("6", sku="OTHER")])
        self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all deferred")

    def snapshot(self, user: str) -> dict[str, object]:
        return cast(dict[str, object], self.as_user(user, _SNAPSHOT)[0][0])

    def test_membership_and_current_owner_are_rechecked_for_prepared_queries(self) -> None:
        self.connection.execute("set local plan_cache_mode='force_generic_plan'")
        self.connection.execute("prepare ownership_security as " + _SNAPSHOT)

        def owned(user: str) -> list[str]:
            return cast(
                dict[str, list[str]], self.as_user(user, "execute ownership_security")[0][0]
            )["owned"]

        self.assertEqual(owned(self.member_a), ["REGISTERED", "SHARED"])
        self.assertEqual(owned(self.member_b), ["OTHER"])
        self.assertEqual(owned(self.outsider), [])
        self.assign("SHARED", self.company_b, rate="13", expected=self.terms_a)
        self.assertEqual(owned(self.member_a), ["REGISTERED"])
        self.assertEqual(owned(self.member_b), ["OTHER", "SHARED"])
        self.connection.execute(
            "delete from public.app_accounts where user_id=%s", (self.member_b,)
        )
        self.assertEqual(owned(self.member_b), [])

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
