"""One lossless authorized SKU catalog supports client-side filter/search menus."""

import json
from typing import cast

import psycopg

from services.db.supabase.tests import test_live_view_equivalence as live_fixture
from services.db.supabase.tests.rpc_support import assert_rpc_contract
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class SkuFilterOptionsTests(SourceModelFixture):
    assign = live_fixture.LiveViewEquivalenceTests.assign
    financial_fixture = live_fixture.LiveViewEquivalenceTests.financial_fixture

    def options(self, user: str) -> dict[str, object]:
        return cast(
            dict[str, object], self.as_user(user, "select public.sku_filter_options()")[0][0]
        )

    def expected(self, user: str) -> dict[str, object]:
        rows = self.as_user(
            user,
            "select sku from public.settlement_preprocess_entries "
            "union select sku from public.data_kiosk_preprocess_entries "
            "union select sku from public.skus",
        )
        skus = {cast(str, row[0]) for row in rows if row[0] is not None}
        return {"values": sorted(skus, key=lambda value: value.encode())}

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
        self.assert_matches_views(self.operator())
        for company in (first, second):
            member = self.member(company)
            self.assertTrue(self.expected(member)["values"])
            self.assert_denied(member)
        for user in (self.auth_user(), ""):
            self.assert_denied(user)

    def test_registered_only_unassigned_unregistered_and_zero_rows_are_in_catalog(self) -> None:
        company, _ = self.owner()
        self.assign("UNASSIGNED", None)
        self.assign("ASSIGNED_NO_TRANSACTIONS", company)
        self.settlement(
            [
                self.transaction("1", line, sku=sku)
                for line, sku in enumerate(("SKU", "UNREGISTERED"), 3)
            ]
        )
        self.kiosk(
            1,
            [
                self.component("0", sku="ZERO_UNREGISTERED"),
                self.component("1", category="SELBOX") | {"sku": None},
            ],
        )
        operator, member = self.operator(), self.member(company)
        self.assertEqual(
            self.assert_matches_views(operator)["values"],
            ["ASSIGNED_NO_TRANSACTIONS", "SKU", "UNASSIGNED", "UNREGISTERED", "ZERO_UNREGISTERED"],
        )
        self.assertEqual(self.expected(member)["values"], ["ASSIGNED_NO_TRANSACTIONS", "SKU"])

    def test_history_current_pointer_reassignment_and_revocation_keep_existing_rls(self) -> None:
        first, sku = self.owner()
        second, _ = self.owner("OTHER")
        self.assign("OLD", first)
        self.assign("OLD_KIOSK", first)
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, version = self.settlement([self.transaction("1", sku="OLD")], acquisition_id=acquisition)
        _, kiosk = self.kiosk(1, [self.component("2", sku="OLD_KIOSK")])
        operator, member_a, member_b = self.operator(), self.member(first), self.member(second)
        self.settlement([self.transaction("3")], acquisition_id=acquisition, expected=version)
        self.kiosk(2, [], expected=kiosk)
        self.assertIn("OLD", cast(list[str], self.assert_matches_views(operator)["values"]))
        # Registered, assigned SKUs remain usable menu options without current facts.
        self.assertIn("OLD", cast(list[str], self.expected(member_a)["values"]))
        terms = self.assign("SKU", second, rate="7", expected=terms)
        self.assert_matches_views(operator)
        for user in (member_a, member_b):
            self.assert_denied(user)
        self.assertNotIn("SKU", cast(list[str], self.expected(member_a)["values"]))
        self.assign("SKU", None, expected=terms)
        self.assertNotIn("SKU", cast(list[str], self.expected(member_b)["values"]))
        self.connection.execute("delete from public.app_accounts where user_id=%s", (member_a,))
        self.assert_denied(member_a)

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
        self.settlement([self.transaction("1", line, sku=sku) for line, sku in enumerate(skus, 3)])
        result = self.assert_matches_views(self.operator())
        self.assertEqual(result, {"values": sorted(skus, key=lambda value: value.encode())})
        self.assertEqual(len(cast(list[object], result["values"])), 1010)

    def test_member_assignments_remain_readable_without_discovery_rpc(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        self.assertEqual(self.as_user(member, "select sku from public.company_skus"), [("SKU",)])
        self.assert_denied(member)

    def test_empty_and_null_only_sources_terminate(self) -> None:
        operator = self.operator()
        self.assertEqual(self.options(operator), {"values": []})
        self.settlement([self.transaction("1", category="SELBOX") | {"sku": None}])
        self.assertEqual(self.options(operator), {"values": []})
        self.kiosk(1, [self.component("0", category="SELBOX") | {"sku": None}])
        self.assertEqual(self.assert_matches_views(operator), {"values": []})
        for user in (self.auth_user(), ""):
            self.assert_denied(user)

    def test_catalog_merges_shared_skus_and_preserves_hidden_skus_and_exact_unicode(self) -> None:
        visible = ["A-visible", "M-visible", "Z-visible"]
        hidden = ["0-hidden", "B-hidden", "Y-hidden", "zz-hidden"]
        imported_only = [" A", "A ", "A", "a", "é", "e\u0301", "Tab\tSKU", "가", "😀"]
        company_a, _ = self.owner(visible[0])
        for sku in [*visible[1:], "REGISTERED-ONLY"]:
            self.assign(sku, company_a)
        self.seller = "seller-two"
        company_b, _ = self.owner(hidden[0])
        for sku in hidden[1:]:
            self.assign(sku, company_b)
        # The other source has an earlier shared-SKU row owned by company A.
        # Its unrelated SKUs remain accessible only to company B.
        self.settlement(
            [
                self.transaction("1", line, sku=sku, activity_date="2026-06-14")
                for line, sku in enumerate([visible[0], *hidden], 3)
            ]
        )
        self.kiosk(1, [self.component("0", sku=sku) for sku in [visible[0], *hidden]])
        self.seller = "seller-one"
        self.settlement(
            [
                self.transaction("1", line, sku=sku)
                for line, sku in enumerate([*visible, *visible, *imported_only], 3)
            ]
        )
        self.kiosk(
            1, [self.component("0", sku=sku) for sku in [*visible, *visible, *imported_only]]
        )
        member_a, member_b, operator = (
            self.member(company_a),
            self.member(company_b),
            self.operator(),
        )
        for user, expected in (
            (member_a, {*visible, "REGISTERED-ONLY"}),
            (member_b, {*hidden}),
            (operator, {*visible, *hidden, *imported_only, "REGISTERED-ONLY"}),
        ):
            self.assertEqual(
                self.assert_matches_views(user) if user == operator else self.expected(user),
                {"values": sorted(expected, key=lambda value: value.encode())},
            )
            if user != operator:
                self.assert_denied(user)
        self.connection.execute("delete from public.app_accounts where user_id=%s", (member_a,))
        self.assert_denied(member_a)

    def test_native_seek_collation_has_a_matching_full_sku_index(self) -> None:
        rows = self.connection.execute(
            "select t.relname,c.collisdeterministic,exists("
            " select 1 from pg_index i join pg_class x on x.oid=i.indexrelid "
            " join pg_am m on m.oid=x.relam where i.indrelid=t.oid "
            " and i.indisvalid and i.indisready and i.indpred is null "
            " and i.indexprs is null and m.amname='btree' "
            " and i.indkey[0]=a.attnum and i.indcollation[0]=a.attcollation) "
            "from pg_class t join pg_attribute a on a.attrelid=t.oid and a.attname='sku' "
            "join pg_collation c on c.oid=a.attcollation "
            "where t.oid in ('private.settlement_transactions'::regclass,"
            "'private.data_kiosk_transactions'::regclass) order by t.relname"
        ).fetchall()
        self.assertEqual(
            rows,
            [
                ("data_kiosk_transactions", True, True),
                ("settlement_transactions", True, True),
            ],
        )

    def test_trusted_invoker_also_requires_an_administrator_app_identity(self) -> None:
        self.financial_fixture()
        self.connection.execute("select set_config('request.jwt.claim.sub','',true)")
        self.connection.execute("select set_config('request.jwt.claims','{}',true)")
        self.assertEqual(
            self.connection.execute("select private.is_operator()").fetchone(), (False,)
        )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("select public.sku_filter_options()")
        # The public RPC boundary does not change privileged direct table access.
        self.assertEqual(
            self.connection.execute(
                "select exists(select 1 from private.settlement_transactions)"
            ).fetchone(),
            (True,),
        )
        self.assert_denied("")

    def test_prepared_catalog_rechecks_demotion_deletion_and_restoration(self) -> None:
        company, _ = self.financial_fixture()
        operator, member, outsider = self.operator(), self.member(company), self.auth_user()
        operator_catalog = self.expected(operator)
        self.connection.execute("set local plan_cache_mode='force_generic_plan'")
        self.connection.execute(
            "prepare catalog_scope_security as select public.sku_filter_options()"
        )
        self.assertEqual(
            self.as_user(operator, "execute catalog_scope_security"), [(operator_catalog,)]
        )
        self.connection.execute(
            "update public.app_accounts set access_role='company_member',company_id=%s "
            "where user_id=%s",
            (company, operator),
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

        for user in (operator, member):
            assert_prepared_denied(user)
        self.connection.execute("delete from public.app_accounts where user_id=%s", (operator,))
        for user in (operator, outsider):
            assert_prepared_denied(user)
        self.connection.execute(
            "insert into public.app_accounts(user_id,access_role) values (%s,'operator')",
            (operator,),
        )
        self.assertEqual(
            self.as_user(operator, "execute catalog_scope_security"), [(operator_catalog,)]
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
                            "app_metadata": {"access_role": "operator"},
                            "user_metadata": {"access_role": "operator"},
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
