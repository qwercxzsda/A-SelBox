"""One lossless authorized SKU catalog supports client-side filter/search menus."""

import json
from typing import cast

import psycopg

from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.rpc_support import assert_rpc_contract
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class SkuFilterOptionsTests(SourceModelFixture):
    assign = FinancialFixture.assign
    financial_fixture = FinancialFixture.financial_fixture

    def options(self, user: str) -> dict[str, object]:
        return cast(
            dict[str, object], self.as_user(user, "select public.sku_filter_options()")[0][0]
        )

    def expected(self, user: str) -> dict[str, object]:
        rows = self.as_user(
            user,
            "select sku from public.finances_preprocess_entries where sku is not null union "
            "select sku from public.company_skus",
        )
        return {"values": sorted({str(row[0]) for row in rows}, key=lambda value: value.encode())}

    def assert_matches_views(self, user: str) -> dict[str, object]:
        result = self.options(user)
        self.assertEqual(result, self.expected(user))
        return result

    def assert_denied(self, user: str) -> None:
        with self.assertRaises(psycopg.errors.InsufficientPrivilege) as raised:
            self.options(user)
        self.assertEqual(raised.exception.diag.message_primary, "Administrator access required")

    def test_catalog_is_administrator_only_without_changing_table_visibility(self) -> None:
        first, second = self.financial_fixture()
        self.assert_matches_views(self.administrator())
        for company in (first, second):
            member = self.member(company)
            self.assertTrue(self.expected(member)["values"])
            self.assert_denied(member)
        for user in (self.auth_user(), ""):
            self.assert_denied(user)

    def test_complete_catalog_exceeds_row_page_limits_and_preserves_unicode(self) -> None:
        skus = [f"SKU-{number:04}" for number in range(1000)] + [
            " A",
            "A ",
            "A",
            "a",
            "Ä",
            "ä",
            "é",
            "e\u0301",
            "가",
            "😀",
        ]
        self.finances([self.transaction("1", line, sku=sku) for line, sku in enumerate(skus, 3)])
        result = self.assert_matches_views(self.administrator())
        self.assertEqual(result, {"values": sorted(skus, key=lambda value: value.encode())})
        self.assertEqual(len(cast(list[object], result["values"])), 1010)

    def test_member_assignments_remain_readable_without_discovery_rpc(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        self.assertEqual(self.as_user(member, "select sku from public.company_skus"), [("SKU",)])
        self.assert_denied(member)

    def test_trusted_invoker_also_requires_an_administrator_app_identity(self) -> None:
        self.financial_fixture()
        self.connection.execute("select set_config('request.jwt.claim.sub','',true)")
        self.connection.execute("select set_config('request.jwt.claims','{}',true)")
        self.assertEqual(
            self.connection.execute("select private.is_administrator()").fetchone(), (False,)
        )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("select public.sku_filter_options()")
        # The public RPC boundary does not change privileged direct table access.
        self.assertEqual(
            self.connection.execute(
                "select exists(select 1 from private.finances_amounts)"
            ).fetchone(),
            (True,),
        )
        self.assert_denied("")

    def test_prepared_catalog_rechecks_demotion_deletion_and_restoration(self) -> None:
        company, _ = self.financial_fixture()
        administrator, member, outsider = (
            self.administrator(),
            self.member(company),
            self.auth_user(),
        )
        administrator_catalog = self.expected(administrator)
        self.connection.execute("set local plan_cache_mode='force_generic_plan'")
        self.connection.execute(
            "prepare catalog_scope_security as select public.sku_filter_options()"
        )
        self.assertEqual(
            self.as_user(administrator, "execute catalog_scope_security"),
            [(administrator_catalog,)],
        )
        self.connection.execute(
            "update public.app_accounts set access_role='member',company_id=%s where user_id=%s",
            (company, administrator),
        )

        def assert_prepared_denied(user: str) -> None:
            # Catch the expected error in PostgreSQL: a client-side rollback can
            # make psycopg deallocate prepared statements before the next actor.
            with self.connection.transaction():
                self.connection.execute(
                    "select set_config('request.jwt.claim.sub',%s,true)", (user,)
                )
                self.connection.execute("set local role authenticated")
                self.connection.execute("""
                    do $test$
                    begin
                        begin
                            execute 'execute catalog_scope_security';
                        exception when insufficient_privilege then
                            if sqlerrm = 'Administrator access required' then return; end if;
                            raise;
                        end;
                        raise exception 'Catalog access unexpectedly allowed';
                    end;
                    $test$;
                """)
                self.connection.execute("reset role")

        for user in (administrator, member):
            assert_prepared_denied(user)
        self.connection.execute(
            "delete from public.app_accounts where user_id=%s", (administrator,)
        )
        for user in (administrator, outsider):
            assert_prepared_denied(user)
        self.connection.execute(
            "insert into public.app_accounts(user_id,access_role) values (%s,'administrator')",
            (administrator,),
        )
        self.assertEqual(
            self.as_user(administrator, "execute catalog_scope_security"),
            [(administrator_catalog,)],
        )
        self.assertEqual(
            self.connection.execute(
                "select generic_plans>=6 from pg_prepared_statements "
                "where name='catalog_scope_security'"
            ).fetchone(),
            (True,),
        )

    def test_role_metadata_cannot_bypass_database_account_gate(self) -> None:
        company, _ = self.owner()
        for user in (self.member(company), self.auth_user()):
            self.connection.execute(
                "select set_config('request.jwt.claims',%s,true)",
                (
                    json.dumps(
                        {
                            "sub": user,
                            "role": "authenticated",
                            "app_metadata": {"access_role": "administrator"},
                            "user_metadata": {"access_role": "administrator"},
                        }
                    ),
                ),
            )
            self.assert_denied(user)

    def test_invoker_contract_and_narrow_execution_grants(self) -> None:
        assert_rpc_contract(self, "sku_filter_options", {})
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.sku_filter_options()")
