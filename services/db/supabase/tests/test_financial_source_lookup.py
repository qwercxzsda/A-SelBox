"""Exact source drilldown preserves observed versions, precision, and admin isolation."""

from typing import cast

from psycopg.errors import InsufficientPrivilege, InvalidParameterValue

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class FinancialSourceLookupTests(SourceModelFixture):
    def test_lookup_keeps_current_and_retained_captures_separate_and_paged(self) -> None:
        capture = self.acquisition()
        original = self.transaction("4.100000001") | {"native_transaction_id": "AMAZON-EXACT"}
        _, old = self.finances([original], acquisition_id=capture)
        _, current = self.finances(
            [self.transaction("4.100000002") | {"native_transaction_id": "AMAZON-EXACT"}],
            acquisition_id=capture,
            version="v1",
        )
        administrator = self.administrator()
        rows = self.as_user(
            administrator,
            "select public.financial_source_transaction_lookup('AMAZON-EXACT')",
        )[0][0]
        self.assertIsInstance(rows, list)
        rows = cast(list[dict[str, str]], rows)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["activity_at"] == "2026-06-15T12:00:00.000000Z" for row in rows))
        self.assertEqual(
            {(row["version_id"], row["is_current"], row["amount"]) for row in rows},
            {(old, "false", "4.100000001"), (current, "true", "4.100000002")},
        )
        for offset in range(2):
            page = self.as_user(
                administrator,
                "select public.financial_source_transaction_lookup('AMAZON-EXACT',1,%s)",
                (offset,),
            )[0][0]
            self.assertEqual(page, [rows[offset]])
        self.assertEqual(
            self.as_user(
                administrator, "select public.financial_source_transaction_lookup('AMAZON')"
            ),
            [([],)],
        )
        old_row = next(row for row in rows if row["version_id"] == old)
        self.assertEqual(
            self.as_user(
                administrator,
                "select public.financial_source_record('FINANCES',%s,%s)->>'amount'",
                (old_row["id"], old),
            ),
            [("4.100000001",)],
        )

    def test_lookup_and_detail_are_administrator_only_even_for_owned_rows(self) -> None:
        company, _ = self.owner()
        self.finances([self.transaction("0")])
        row = self.connection.execute(
            "select id,version_id from private.finances_amounts limit 1"
        ).fetchone()
        row = require_row(row)
        for user in (self.member(company), self.auth_user()):
            with self.assertRaises(InsufficientPrivilege):
                self.as_user(user, "select public.financial_source_record('FINANCES',%s,%s)", row)
            with self.assertRaises(InsufficientPrivilege):
                self.as_user(user, "select public.financial_source_transaction_lookup('any')")
        self.assertEqual(
            self.connection.execute(
                "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='public' and p.proname in ('financial_source_record',"
                "'financial_source_transaction_lookup') and not p.prosecdef and p.provolatile='s' "
                "and has_function_privilege('authenticated',p.oid,'EXECUTE') "
                "and not has_function_privilege('anon',p.oid,'EXECUTE') "
                "and not has_function_privilege('service_role',p.oid,'EXECUTE')"
            ).fetchone(),
            (2,),
        )

    def test_lookup_limits_and_source_identity_are_validated(self) -> None:
        administrator = self.administrator()
        for native, limit, offset in (
            (None, 25, 0),
            (" ", 25, 0),
            ("x" * 513, 25, 0),
            ("a", 101, 0),
            ("a", 0, 0),
            ("a", 1, -1),
        ):
            with self.subTest(native=native, limit=limit), self.assertRaises(InvalidParameterValue):
                self.as_user(
                    administrator,
                    "select public.financial_source_transaction_lookup(%s,%s,%s)",
                    (native, limit, offset),
                )
        with self.assertRaises(InvalidParameterValue):
            self.as_user(
                administrator,
                "select public.financial_source_record('other',%s,%s)",
                (new_id(), new_id()),
            )
