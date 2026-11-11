"""Exact source drilldown preserves observed versions, precision, and admin isolation."""

from typing import cast

from psycopg import sql
from psycopg.errors import InsufficientPrivilege, InvalidParameterValue

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class FinancialSourceLookupTests(SourceModelFixture):
    def test_source_detail_matches_both_ids_and_preserves_numeric_text(self) -> None:
        self.finances([self.transaction("9007199254740993.000000001")])
        self.kiosk(1, [self.component("-0.000000009")])
        administrator = self.administrator()
        for source, relation in (
            ("FINANCES", "finances_transaction_components"),
            ("DATA_KIOSK", "data_kiosk_day_components"),
        ):
            row = self.connection.execute(
                sql.SQL("select id,version_id,amount::text from private.{} limit 1").format(
                    sql.Identifier(relation)
                )
            ).fetchone()
            row = require_row(row)
            record = self.as_user(
                administrator,
                "select public.financial_source_record(%s,%s,%s)",
                (source, row[0], row[1]),
            )[0][0]
            self.assertIsInstance(record, dict)
            record = cast(dict[str, object], record)
            self.assertEqual(record["amount"], row[2])
            self.assertEqual(record["id"], str(row[0]))
            self.assertEqual(
                record["activity_at"],
                "2026-06-15T12:00:00.000000Z"
                if source == "FINANCES"
                else "2026-06-16T06:59:59.999999Z",
            )
            self.assertTrue(
                all(value is None or isinstance(value, str) for value in record.values())
            )
            self.assertEqual(
                self.as_user(
                    administrator,
                    "select public.financial_source_record(%s,%s,%s)",
                    (source, row[0], new_id()),
                ),
                [(None,)],
            )

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
            {(row["version_id"], row["capture_status"], row["amount"]) for row in rows},
            {(old, "Retained", "4.100000001"), (current, "Current", "4.100000002")},
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
            "select id,version_id from private.finances_transaction_components limit 1"
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
