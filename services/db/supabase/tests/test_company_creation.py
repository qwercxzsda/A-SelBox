"""Company creation is administrator-only, idempotent, and a normal catalog revision."""

from concurrent.futures import ThreadPoolExecutor
from typing import cast
from uuid import UUID

import psycopg
from psycopg.conninfo import make_conninfo

from services.db.supabase.tests.concurrency_support import wait_for_block
from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.local_database import DEFAULT_DATABASE_URL
from services.db.supabase.tests.source_fixtures import SourceModelFixture
from services.sync.src.database.company_terms import create_company

_CREATE = "select id::text,name,created from public.create_company(%s)"


class CompanyCreationTests(SourceModelFixture):
    def create(self, administrator: str, name: str | None) -> tuple[str, str, bool]:
        return cast(tuple[str, str, bool], self.as_user(administrator, _CREATE, (name,))[0])

    def fees_revision(self, administrator: str) -> str:
        result = self.as_user(
            administrator, "select public.workspace_revisions(array['fees'])->'revisions'->>'fees'"
        )
        return cast(str, result[0][0])

    def test_creation_trims_outer_whitespace_and_reuses_existing_case_insensitive_name(
        self,
    ) -> None:
        administrator = self.administrator()
        company, name, created = self.create(administrator, " \t New  Company\n ")
        self.assertEqual((name, created), ("New  Company", True))
        self.assertEqual(UUID(company).version, 7)
        self.assertEqual(
            self.create(administrator, "new  COMPANY"), (company, "New  Company", False)
        )
        self.assertEqual(
            self.as_user(administrator, "select id::text,name from public.companies"),
            [(company, "New  Company")],
        )
        self.assertNotEqual(self.create(administrator, "New Company")[0], company)

    def test_company_names_are_required_and_limited_after_trimming(self) -> None:
        administrator = self.administrator()
        for name in (None, "", " \t\n\r ", "x" * 201):
            with self.subTest(name=name), self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.create(administrator, name)
        self.assertEqual(self.create(administrator, " " + "회" * 200 + " ")[1], "회" * 200)

    def test_existing_trusted_names_are_reused_without_restricting_python_creation(self) -> None:
        administrator = self.administrator()
        database = TransactionDatabase(self.connection)
        first = create_company(database, "Existing Name")
        second = create_company(database, "existing name")
        self.assertNotEqual(first, second)
        self.assertEqual(
            self.create(administrator, " EXISTING NAME "), (first, "Existing Name", False)
        )
        self.assertEqual(
            self.connection.execute("select count(*) from public.companies").fetchone(), (2,)
        )

    def test_members_unassigned_and_anonymous_cannot_create_or_write_companies(self) -> None:
        company, _ = self.owner()
        administrator, member, unassigned = (
            self.administrator(),
            self.member(company),
            self.auth_user(),
        )
        self.connection.execute(
            "select set_config('request.jwt.claims',"
            '\'{"user_metadata":{"access_role":"administrator"}}\',true)'
        )
        for caller in (member, unassigned):
            for name in ("Unauthorized", None):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.create(caller, name)
        for caller in (administrator, member, unassigned):
            for query in (
                "insert into public.companies(name) values ('Direct') returning id",
                "update public.companies set name='Renamed' returning id",
                "delete from public.companies returning id",
            ):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.as_user(caller, query)
        for role in ("anon", "service_role"):
            with (
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute(f"set local role {role}")
                self.connection.execute(_CREATE, ("Unauthorized",))

    def test_committed_insert_bumps_fees_revision_but_reuse_does_not(self) -> None:
        administrator = self.administrator()
        self.connection.commit()
        before = self.fees_revision(administrator)
        self.connection.execute("select 1")  # Keep the caller transaction open across RPC helpers.
        self.create(administrator, "Catalog company")
        self.assertEqual(self.fees_revision(administrator), before)
        self.connection.commit()
        after = self.fees_revision(administrator)
        self.assertNotEqual(after, before)
        self.create(administrator, " CATALOG COMPANY ")
        self.connection.commit()
        self.assertEqual(self.fees_revision(administrator), after)

    def test_competing_equivalent_names_return_one_company(self) -> None:
        administrator = self.administrator()
        self.connection.commit()
        database_url = make_conninfo(DEFAULT_DATABASE_URL, dbname=self.connection.info.dbname)
        self.connection.execute("select 1")  # Hold the first creator's lock until the second waits.
        first = self.create(administrator, "Concurrent Company")
        with (
            psycopg.connect(database_url, autocommit=True) as observer,
            ThreadPoolExecutor(max_workers=1) as executor,
        ):

            def create_competing_company() -> tuple[object, ...] | None:
                with psycopg.connect(database_url, application_name="company-creator") as creator:
                    creator.execute("set statement_timeout = '10s'")
                    creator.execute(
                        "select set_config('request.jwt.claim.sub',%s,true)", (administrator,)
                    )
                    creator.execute("set local role authenticated")
                    return creator.execute(_CREATE, (" concurrent COMPANY ",)).fetchone()

            future = executor.submit(create_competing_company)
            try:
                wait_for_block(observer, "company-creator")
            finally:
                self.connection.commit()
            self.assertEqual(future.result(timeout=10), (first[0], first[1], False))
        self.assertEqual(
            self.connection.execute("select count(*) from public.companies").fetchone(), (1,)
        )
