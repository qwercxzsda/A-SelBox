"""The administration entry point uses trusted DB credentials and validates input."""

import unittest
from unittest.mock import patch
from uuid import uuid4

from services.sync.src.cli.administrator_access import main
from services.sync.src.database.account_access import set_administrator_access
from services.sync.tests.support.fakes import FakeDatabaseConnection


class AdministratorAccessTests(unittest.TestCase):
    def test_returns_server_role_inside_a_transaction(self) -> None:
        user = str(uuid4())
        database = FakeDatabaseConnection([("administrator",)])
        self.assertEqual(
            set_administrator_access(database, user_id=user, enabled=True), "administrator"
        )
        self.assertEqual(database.connection_obj.transaction_count, 1)
        self.assertEqual(database.execute_calls[0][1], {"user_id": user, "enabled": True})

    def test_validates_all_canonical_role_results(self) -> None:
        for role in ("administrator", "member", "unassigned"):
            with self.subTest(role=role):
                database = FakeDatabaseConnection([(role,)])
                self.assertEqual(
                    set_administrator_access(database, user_id=str(uuid4()), enabled=False), role
                )
        for role in ("operator", "company_member", "unknown"):
            with self.subTest(rejected=role):
                database = FakeDatabaseConnection([(role,)])
                with self.assertRaisesRegex(RuntimeError, "invalid account"):
                    set_administrator_access(database, user_id=str(uuid4()), enabled=False)

    def test_rejects_invalid_identity_before_acquiring_a_connection(self) -> None:
        database = FakeDatabaseConnection()
        with self.assertRaises(ValueError):
            set_administrator_access(database, user_id="not-a-user", enabled=False)
        self.assertEqual(database.connection_obj.transaction_count, 0)

    def test_missing_database_url_does_not_fall_back_to_local_database(self) -> None:
        with (
            patch.dict("os.environ", {}, clear=True),
            patch("sys.stderr"),
            self.assertRaises(SystemExit) as error,
        ):
            main(["grant", str(uuid4()), "--no-load-dotenv"])
        self.assertEqual(error.exception.code, 2)
