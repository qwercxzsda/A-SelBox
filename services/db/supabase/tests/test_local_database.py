"""Unit checks for explicit loopback-only database safeguards."""

import unittest
from unittest.mock import patch

from psycopg.conninfo import conninfo_to_dict

from services.db.supabase.tests.isolated_database import isolated_database
from services.db.supabase.tests.local_database import (
    DEFAULT_DATABASE_URL,
    UnsafeDatabaseUrlError,
    require_local_supabase_url,
)


class LocalDatabaseGuardTests(unittest.TestCase):
    def test_disposable_connections_pin_the_validated_loopback_address(self) -> None:
        for host, address in (
            ("127.0.0.1", "127.0.0.1"),
            ("localhost", "127.0.0.1"),
            ("[::1]", "::1"),
        ):
            with (
                self.subTest(host=host),
                patch("services.db.supabase.tests.isolated_database.psycopg.connect") as connect,
            ):
                with isolated_database(DEFAULT_DATABASE_URL.replace("127.0.0.1", host)) as target:
                    self.assertEqual(conninfo_to_dict(target)["hostaddr"], address)
                self.assertEqual(connect.call_count, 2)
                for call in connect.call_args_list:
                    # Explicit hostaddr takes precedence over PGHOSTADDR and a
                    # service-file address without mutating ambient credentials.
                    self.assertEqual(conninfo_to_dict(call.args[0])["hostaddr"], address)

    def test_accepts_expected_local_database(self) -> None:
        require_local_supabase_url(DEFAULT_DATABASE_URL)
        require_local_supabase_url(DEFAULT_DATABASE_URL.replace("127.0.0.1", "localhost"))
        require_local_supabase_url(DEFAULT_DATABASE_URL.replace("127.0.0.1", "[::1]"))

    def test_rejects_remote_or_unexpected_targets(self) -> None:
        for value in (
            DEFAULT_DATABASE_URL.replace("127.0.0.1", "db.example.test"),
            DEFAULT_DATABASE_URL.replace("54322", "5432"),
            DEFAULT_DATABASE_URL + "?sslmode=require",
            DEFAULT_DATABASE_URL + "#fragment",
            " " + DEFAULT_DATABASE_URL,
            DEFAULT_DATABASE_URL + " ",
            "",
            DEFAULT_DATABASE_URL.replace("postgresql://", "postgres://"),
            DEFAULT_DATABASE_URL.replace("postgres:postgres@", "another:postgres@"),
            DEFAULT_DATABASE_URL.replace(":54322/", ":not-a-port/"),
            DEFAULT_DATABASE_URL.replace("127.0.0.1", "[::1"),
            DEFAULT_DATABASE_URL.rsplit("/", 1)[0] + "/another_database",
        ):
            with self.subTest(value=value), self.assertRaises(UnsafeDatabaseUrlError):
                require_local_supabase_url(value)
