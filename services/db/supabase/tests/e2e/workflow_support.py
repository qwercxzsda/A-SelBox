"""Shared disposable services, authenticated users, and API assertions."""

import secrets
import unittest
from typing import cast
from uuid import uuid7

import httpx

from services.db.supabase.tests.e2e.local_stack import LocalSupabaseStack
from services.sync.src.archives.storage import SupabaseArchiveStorage
from services.sync.src.database.connection import PostgresDatabaseConnection


class LocalWorkflowCase(unittest.TestCase):
    """Own one stack per concrete test class and fresh source identities per case."""

    stack: LocalSupabaseStack

    @classmethod
    def setUpClass(cls) -> None:
        cls.stack = cls.enterClassContext(LocalSupabaseStack())

    def setUp(self) -> None:
        self.database = self.enterContext(PostgresDatabaseConnection(self.stack.database_url))
        self.storage = SupabaseArchiveStorage(self.stack.api_url, self.stack.service_key)
        self.seller = f"local-e2e-{uuid7()}"
        # The synthetic August reports exercise mature Settlement authority.
        # Fix the disposable database clock boundary so calendar time cannot
        # silently switch these transport tests to the recent Data Kiosk policy.
        with self.database.connection() as connection, connection.transaction():
            connection.execute(
                "create or replace function private.mature_cutoff_date() "
                "returns date language sql stable parallel safe security invoker "
                "set search_path = '' as $$ select date '2026-09-01' $$"
            )

    def create_auth_user(self, *, user_metadata: dict[str, str] | None = None) -> tuple[str, str]:
        """Create an existing Auth account with no app access, then sign in normally."""
        email = f"local-e2e-{uuid7().hex}@example.invalid"
        password = secrets.token_urlsafe(32)
        created = self.stack.request(
            "POST",
            "/auth/v1/admin/users",
            admin=True,
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": user_metadata or {},
            },
        )
        self.assertEqual(created.status_code, 200)
        user_id = cast(str, created.json()["id"])
        return user_id, self.sign_in(email, password)

    def sign_in(self, email: str, password: str) -> str:
        """Obtain an Auth-issued authenticated JWT; credentials remain in memory."""
        signed_in = self.stack.request(
            "POST",
            "/auth/v1/token?grant_type=password",
            json={"email": email, "password": password},
        )
        self.assertEqual(signed_in.status_code, 200)
        return cast(str, signed_in.json()["access_token"])

    def create_operator(self) -> tuple[str, str]:
        """Bootstrap an operator in SQL; subsequent requests use its ordinary JWT."""
        user_id, token = self.create_auth_user()
        with self.database.connection() as connection, connection.transaction():
            connection.execute(
                "insert into public.app_accounts(user_id, access_role) values (%s, 'operator')",
                (user_id,),
            )
        return user_id, token

    def create_member(self, company: str) -> tuple[str, str]:
        """Bootstrap a member fixture without granting it operator capabilities."""
        user_id, token = self.create_auth_user()
        with self.database.connection() as connection, connection.transaction():
            connection.execute(
                "insert into public.app_accounts(user_id, company_id) values (%s, %s)",
                (user_id, company),
            )
        return user_id, token

    def read_rows(self, relation: str, token: str, **params: str) -> list[dict[str, object]]:
        response = self.stack.request("GET", "/rest/v1/" + relation, token=token, params=params)
        self.assertEqual(response.status_code, 200)
        return cast(list[dict[str, object]], response.json())

    def assert_storage_denied(self, response: httpx.Response, *, write: bool = False) -> None:
        # HTTP 400 can wrap an authorization/not-found code; generic bad input must fail.
        self.assertIn(response.status_code, (400, 401, 403, 404))
        self.assertIn(
            str(response.json().get("statusCode")),
            ("401", "403") if write else ("401", "403", "404"),
        )
