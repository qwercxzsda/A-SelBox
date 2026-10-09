"""Signup and membership changes never trust editable metadata or expose admin writes."""

from concurrent.futures import ThreadPoolExecutor

import psycopg
from psycopg.conninfo import make_conninfo

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id
from services.sync.src.database.account_access import set_administrator_access

_MUTATE = (
    "select user_id::text,access_role,company_id::text "
    "from public.set_company_membership(%s,%s,%s,%s)"
)


class AppAccountTests(SourceModelFixture):
    def test_unassigned_cannot_read_populated_financial_sources_or_references(self) -> None:
        company, _ = self.owner()
        self.member(company)
        self.settlement([self.transaction("20")])
        self.kiosk(1, [self.component("-4")])
        user = self.auth_user()
        for query in (
            "select * from private.settlement_transactions",
            "select * from private.data_kiosk_transactions",
            "select id from private.settlements",
            "select id from private.data_kiosk_days",
            "select id from private.settlement_preprocess_versions",
            "select id from private.data_kiosk_preprocess_versions",
            "select * from public.company_skus",
            "select * from public.current_sku_fee_periods",
            "select * from public.live_company_components",
            "select * from public.financial_review_records",
        ):
            with self.subTest(query=query):
                self.assertEqual(self.as_user(user, query), [])

    def test_concurrent_db_promotion_cannot_be_overwritten_by_membership_edit(self) -> None:
        company, _ = self.owner()
        administrator, user = self.administrator(), self.auth_user()
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        with (
            psycopg.connect(database_url) as manager,
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):
            manager.execute("select * from private.set_administrator_access(%s,true)", (user,))

            def edit_membership() -> str | None:
                with psycopg.connect(
                    database_url, application_name="concurrent-membership"
                ) as editor:
                    editor.execute("set statement_timeout = '10s'")
                    editor.execute(
                        "select set_config('request.jwt.claim.sub',%s,true)", (administrator,)
                    )
                    editor.execute("set local role authenticated")
                    try:
                        editor.execute(_MUTATE, (user, company, "unassigned", None))
                    except psycopg.Error as error:
                        return error.sqlstate
                    return None

            future = executor.submit(edit_membership)
            try:
                wait_for_block(observer, "concurrent-membership")
            finally:
                manager.commit()
            self.assertEqual(future.result(timeout=10), "42501")
        self.assertEqual(
            self.connection.execute(
                "select access_role,company_id from public.app_accounts where user_id=%s", (user,)
            ).fetchone(),
            ("administrator", None),
        )

    def test_signup_is_unassigned_ignores_metadata_and_cascades_on_auth_deletion(self) -> None:
        user = new_id()
        self.connection.execute(
            "insert into auth.users(id,email,raw_user_meta_data) values (%s,'signup@example.test',"
            '\'{"access_role":"administrator","company_id":"forged"}\')',
            (user,),
        )
        self.assertEqual(
            self.as_user(user, "select access_role,company_id from public.app_accounts"),
            [("unassigned", None)],
        )
        self.assertEqual(self.as_user(user, "select id from public.companies"), [])
        self.assertEqual(self.as_user(user, "select * from public.live_company_components"), [])
        with self.assertRaises(psycopg.errors.UniqueViolation), self.connection.transaction():
            self.connection.execute("insert into public.app_accounts(user_id) values (%s)", (user,))
        self.connection.execute("delete from auth.users where id=%s", (user,))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.app_accounts where user_id=%s", (user,)
            ).fetchone(),
            (0,),
        )

    def test_account_role_company_shape_is_enforced(self) -> None:
        company, _ = self.owner()
        user = self.auth_user()
        for role, assigned in (
            ("member", None),
            ("administrator", company),
            ("unassigned", company),
        ):
            with (
                self.subTest(role=role),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "update public.app_accounts set access_role=%s,company_id=%s where user_id=%s",
                    (role, assigned, user),
                )
        with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.connection.transaction():
            self.connection.execute(
                "update public.app_accounts set access_role='member',company_id=%s "
                "where user_id=%s",
                (new_id(), user),
            )

    def test_administrator_assigns_transfers_and_revokes_without_changing_auth_identity(
        self,
    ) -> None:
        company, _ = self.owner()
        other, _ = self.owner("OTHER")
        administrator, user = self.administrator(), self.auth_user()
        for selected, expected_role, expected_company in (
            (company, "unassigned", None),
            (other, "member", company),
            (None, "member", other),
        ):
            self.assertEqual(
                self.as_user(
                    administrator, _MUTATE, (user, selected, expected_role, expected_company)
                ),
                [(user, "member" if selected else "unassigned", selected)],
            )
            self.assertEqual(
                self.as_user(user, "select id::text from public.companies"),
                [(selected,)] if selected else [],
            )
        self.assertEqual(
            self.as_user(user, "select user_id::text,access_role from public.app_accounts"),
            [(user, "unassigned")],
        )
        self.assertEqual(
            self.connection.execute(
                "select id::text from auth.users where id=%s", (user,)
            ).fetchone(),
            (user,),
        )

    def test_stale_changes_and_unknown_targets_fail_without_overwriting_membership(self) -> None:
        company, _ = self.owner()
        administrator, user = self.administrator(), self.auth_user()
        self.as_user(administrator, _MUTATE, (user, company, "unassigned", None))
        with self.assertRaises(psycopg.Error) as error:
            self.as_user(administrator, _MUTATE, (user, None, "unassigned", None))
        self.assertEqual(error.exception.sqlstate, "PT409")
        with self.assertRaises(psycopg.errors.NoDataFound):
            self.as_user(administrator, _MUTATE, (new_id(), company, "unassigned", None))
        self.assertEqual(
            self.as_user(user, "select company_id::text from public.app_accounts"), [(company,)]
        )

    def test_only_administrators_read_email_directory_or_manage_members(self) -> None:
        company, _ = self.owner()
        administrator, member, unassigned = (
            self.administrator(),
            self.member(company),
            self.auth_user(),
        )
        self.connection.execute(
            "update auth.users set email='member@example.test',email_confirmed_at=now() "
            "where id=%s",
            (member,),
        )
        self.assertEqual(
            self.as_user(
                administrator,
                "select email,email_confirmed from public.account_directory() where user_id=%s",
                (member,),
            ),
            [("member@example.test", True)],
        )
        self.connection.execute(
            "update auth.users set email='changed@example.test' where id=%s", (member,)
        )
        self.assertEqual(
            self.as_user(
                administrator,
                "select email from public.account_directory() where user_id=%s",
                (member,),
            ),
            [("changed@example.test",)],
        )
        for caller in (member, unassigned):
            self.connection.execute(
                "select set_config('request.jwt.claims',"
                '\'{"user_metadata":{"access_role":"administrator"}}\',true)'
            )
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(caller, "select * from public.account_directory()")
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(caller, _MUTATE, (unassigned, company, "unassigned", None))
        for target in (administrator, self.administrator()):
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(administrator, _MUTATE, (target, company, "administrator", None))

    def test_no_browser_or_service_role_can_change_administrators(self) -> None:
        company, _ = self.owner()
        administrator, member, unassigned = (
            self.administrator(),
            self.member(company),
            self.auth_user(),
        )
        for caller in (administrator, member, unassigned):
            for query in (
                "insert into public.app_accounts(user_id) values (gen_random_uuid()) "
                "returning user_id",
                "update public.app_accounts set access_role='administrator',company_id=null "
                "returning user_id",
                "delete from public.app_accounts returning user_id",
                "select * from private.set_administrator_access(auth.uid(),true)",
            ):
                with (
                    self.subTest(query=query),
                    self.assertRaises(psycopg.errors.InsufficientPrivilege),
                ):
                    self.as_user(caller, query)
        for role in ("anon", "service_role"):
            with (
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute(f"set local role {role}")
                self.connection.execute(
                    "select * from private.set_administrator_access(%s,true)", (unassigned,)
                )

    def test_trusted_python_function_grants_and_revokes_administrators(self) -> None:
        company, _ = self.owner()
        user = self.member(company)
        database = TransactionDatabase(self.connection)
        self.assertEqual(set_administrator_access(database, user_id=user, enabled=False), "member")
        self.assertEqual(
            set_administrator_access(database, user_id=user, enabled=True), "administrator"
        )
        self.assertEqual(
            self.as_user(user, "select access_role,company_id from public.app_accounts"),
            [("administrator", None)],
        )
        self.assertEqual(
            set_administrator_access(database, user_id=user, enabled=False), "unassigned"
        )
        self.assertEqual(self.as_user(user, "select * from public.companies"), [])
        with self.assertRaises(psycopg.errors.NoDataFound), self.connection.transaction():
            set_administrator_access(database, user_id=new_id(), enabled=True)

    def test_anonymous_has_no_application_reads_or_mutations(self) -> None:
        for query in (
            "select * from public.app_accounts",
            "select * from public.live_company_components",
            "select * from public.account_directory()",
            "select * from public.set_company_membership(null,null,'unassigned',null)",
        ):
            with (
                self.subTest(query=query),
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute("set local role anon")
                self.connection.execute(query)
