"""Application accounts authorize members without trusting editable token metadata."""

from typing import LiteralString

import psycopg

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class AppAccountTests(SourceModelFixture):
    def test_one_account_per_auth_user_and_role_company_shape(self) -> None:
        company, _ = self.owner()
        user = self.auth_user()
        for role, assigned in (("company_member", None), ("operator", company)):
            with (
                self.subTest(role=role),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "insert into public.app_accounts(user_id,access_role,company_id) "
                    "values (%s,%s,%s)",
                    (user, role, assigned),
                )
        for auth_id, assigned in ((new_id(), company), (user, new_id())):
            with (
                self.assertRaises(psycopg.errors.ForeignKeyViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "insert into public.app_accounts(user_id,company_id) values (%s,%s)",
                    (auth_id, assigned),
                )
        self.connection.execute(
            "insert into public.app_accounts(user_id,company_id) values (%s,%s)",
            (user, company),
        )
        self.assertEqual(
            self.connection.execute(
                "select access_role,company_id::text from public.app_accounts where user_id=%s",
                (user,),
            ).fetchone(),
            ("company_member", company),
        )
        with self.assertRaises(psycopg.errors.UniqueViolation), self.connection.transaction():
            self.connection.execute(
                "insert into public.app_accounts(user_id,access_role) values (%s,'operator')",
                (user,),
            )
        self.connection.execute("delete from auth.users where id=%s", (user,))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.app_accounts where user_id=%s", (user,)
            ).fetchone(),
            (0,),
        )

    def test_operator_manages_existing_auth_members_and_changes_apply_immediately(self) -> None:
        company, _ = self.owner()
        other_company, _ = self.owner("OTHER")
        operator, user = self.operator(), self.auth_user()
        self.assertEqual(self.as_user(user, "select id from public.companies"), [])
        self.assertEqual(
            self.as_user(
                operator,
                "insert into public.app_accounts(user_id,company_id) values (%s,%s) "
                "returning user_id::text,access_role,company_id::text",
                (user, company),
            ),
            [(user, "company_member", company)],
        )
        self.assertEqual(self.as_user(user, "select id::text from public.companies"), [(company,)])
        self.assertEqual(
            self.as_user(
                operator,
                "update public.app_accounts set company_id=%s where user_id=%s "
                "returning company_id::text",
                (other_company, user),
            ),
            [(other_company,)],
        )
        self.assertEqual(
            self.as_user(user, "select id::text from public.companies"), [(other_company,)]
        )
        self.assertEqual(
            self.as_user(
                operator,
                "delete from public.app_accounts where user_id=%s returning user_id::text",
                (user,),
            ),
            [(user,)],
        )
        self.assertEqual(self.as_user(user, "select * from public.app_accounts"), [])
        self.assertEqual(self.as_user(user, "select * from public.companies"), [])
        self.assertEqual(
            self.connection.execute(
                "select id::text from auth.users where id=%s", (user,)
            ).fetchone(),
            (user,),
        )

    def test_operators_cannot_promote_members_or_edit_operator_accounts(self) -> None:
        company, _ = self.owner()
        operator, other_operator = self.operator(), self.operator()
        member, unconfigured = self.member(company), self.auth_user()
        attempts: tuple[tuple[LiteralString, tuple[str, ...]], ...] = (
            (
                "insert into public.app_accounts(user_id,access_role) values (%s,'operator') "
                "returning user_id",
                (unconfigured,),
            ),
            (
                "update public.app_accounts set access_role='operator',company_id=null "
                "where user_id=%s returning user_id",
                (member,),
            ),
        )
        for query, parameters in attempts:
            with self.subTest(query=query), self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(operator, query, parameters)
        for target in (operator, other_operator):
            self.assertEqual(
                self.as_user(
                    operator,
                    "update public.app_accounts set company_id=%s "
                    "where user_id=%s returning user_id",
                    (company, target),
                ),
                [],
            )
            self.assertEqual(
                self.as_user(
                    operator,
                    "delete from public.app_accounts where user_id=%s returning user_id",
                    (target,),
                ),
                [],
            )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.app_accounts where access_role='operator'"
            ).fetchone(),
            (2,),
        )

    def test_members_and_unconfigured_users_cannot_write_accounts_or_spoof_access(self) -> None:
        company, _ = self.owner()
        other_company, _ = self.owner("OTHER")
        member, other_member = self.member(company), self.member(other_company)
        self.operator()
        unconfigured, target = self.auth_user(), self.auth_user()
        self.connection.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (
                '{"user_metadata":{"access_role":"operator"},"app_metadata":{"access_role":"operator"}}',
            ),
        )
        self.assertEqual(
            self.as_user(member, "select user_id::text from public.app_accounts"), [(member,)]
        )
        self.assertEqual(self.as_user(unconfigured, "select * from public.app_accounts"), [])
        for user in (member, unconfigured):
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.as_user(
                    user,
                    "insert into public.app_accounts(user_id,company_id) values (%s,%s) "
                    "returning user_id",
                    (target, company),
                )
            for account in (member, other_member):
                self.assertEqual(
                    self.as_user(
                        user,
                        "update public.app_accounts set company_id=%s where user_id=%s "
                        "returning user_id",
                        (other_company, account),
                    ),
                    [],
                )
                self.assertEqual(
                    self.as_user(
                        user,
                        "delete from public.app_accounts where user_id=%s returning user_id",
                        (account,),
                    ),
                    [],
                )

    def test_anonymous_has_no_application_reads_or_account_writes(self) -> None:
        for query in (
            "select * from public.app_accounts",
            "select * from public.live_company_components",
            "select * from public.company_payout_reports",
            "select * from public.company_payout_report_components",
            "insert into public.app_accounts(user_id) values (gen_random_uuid())",
            "update public.app_accounts set company_id=null",
            "delete from public.app_accounts",
        ):
            with (
                self.subTest(query=query),
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute("set local role anon")
                self.connection.execute(query)
