"""Current-schema seed imports reject obsolete shapes and never expose COPY cells."""

import hashlib
import traceback
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast
from unittest.mock import Mock

from psycopg import sql

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id
from services.db.supabase.tests.verification.financial_seed import Connection, load_financial_seed


class FinancialSeedTests(SourceModelFixture):
    def seed_file(self, content: str) -> Path:
        directory = self.enterContext(TemporaryDirectory(prefix="aselbox-seed-test-"))
        path = Path(directory) / "synthetic.sql"
        path.write_text(content, encoding="utf-8")
        return path

    @staticmethod
    def company_copy(name: str = "Synthetic company") -> str:
        return (
            "COPY public.companies (id,name,created_at) FROM stdin;\n"
            f"{new_id()}\t{name}\t2026-01-01 00:00:00+00\n\\.\n"
        )

    def acquisition_copy(self) -> tuple[str, str]:
        identity = self.acquisition()
        columns = [
            str(row[0])
            for row in self.connection.execute(
                "select column_name from information_schema.columns "
                "where table_schema='private' and table_name='settlement_acquisitions' "
                "order by ordinal_position"
            ).fetchall()
        ]
        statement = sql.SQL("copy private.settlement_acquisitions ({}) to stdout").format(
            sql.SQL(", ").join(sql.Identifier(column) for column in columns)
        )
        with self.connection.cursor().copy(statement) as copier:
            body = b"".join(bytes(chunk) for chunk in copier).decode()
        self.connection.rollback()
        return (
            f"COPY private.settlement_acquisitions ({', '.join(columns)}) FROM stdin;\n"
            + body
            + "\\.\n",
            identity,
        )

    def assert_preflight_rejection(self, trailing_block: str, message: str) -> None:
        seed = self.seed_file(self.company_copy() + trailing_block)
        observed = Mock(wraps=self.connection)
        with self.assertRaisesRegex(ValueError, message):
            load_financial_seed(cast(Connection, observed), seed)
        observed.cursor.assert_not_called()
        observed.transaction.assert_not_called()
        self.assertEqual(
            self.connection.execute("select count(*) from public.companies").fetchone(), (0,)
        )

    def test_unknown_application_tables_are_rejected_before_copying_any_rows(self) -> None:
        self.assert_preflight_rejection(
            "COPY public.unknown_relation (id) FROM stdin;\n\\.\n",
            "table absent from the current schema",
        )

    def test_inventory_stays_outside_financial_source_imports(self) -> None:
        columns = [
            str(row[0])
            for row in self.connection.execute(
                "select column_name from information_schema.columns "
                "where table_schema='private' and table_name='inventory_items' "
                "order by ordinal_position"
            ).fetchall()
        ]
        seed = self.seed_file(
            self.company_copy()
            + f"COPY private.inventory_items ({', '.join(columns)}) FROM stdin;\n"
            + "inventory cells are not consumed by financial fixtures\n\\.\n"
        )
        result = load_financial_seed(self.connection, seed)
        self.assertEqual(result["source_rows"], {"public.companies": 1})
        self.assertEqual(
            self.connection.execute("select count(*) from private.inventory_items").fetchone(),
            (0,),
        )

    def test_mismatched_current_headers_and_duplicate_columns_fail_before_copy(self) -> None:
        for header in (
            "COPY public.companies (id,name) FROM stdin;\n",
            "COPY public.companies (id,name,created_at,unexpected) FROM stdin;\n",
            "COPY public.companies (id,name,created_at,id) FROM stdin;\n",
            "COPY private.settlements (id) FROM stdin;\n",
        ):
            with self.subTest(header=header):
                self.assert_preflight_rejection(
                    header + "\\.\n", "columns do not match current migrations"
                )
        self.assert_preflight_rejection(
            "COPY auth.users (encrypted_password) FROM stdin;\n\\.\n", "Auth COPY header"
        )
        self.assert_preflight_rejection(
            "COPY public.companies (id,name,created_at) FROM stdin;\n", "unterminated COPY block"
        )

    def test_current_source_copy_reordered_columns_and_auth_id_projection_are_accepted(
        self,
    ) -> None:
        source_copy, acquisition = self.acquisition_copy()
        user, company = new_id(), new_id()
        name = "COPY public.unknown_relation (id) FROM stdin;"
        seed = self.seed_file(
            "".join(
                (
                    "select 1 / 0; -- Dump SQL must never be executed.\n",
                    "COPY auth.users (id,encrypted_password,raw_user_meta_data) FROM stdin;\n",
                    f'{user}\tnever-import-this-password\t{{"private":"never-import-profile"}}\n\\.\n',
                    "COPY public.companies (name,id,created_at) FROM stdin;\n",
                    f"{name}\t{company}\t2026-01-01 00:00:00+00\n\\.\n",
                    source_copy,
                )
            )
        )
        result = load_financial_seed(self.connection, seed)
        self.assertEqual(
            result["source_rows"], {"public.companies": 1, "private.settlement_acquisitions": 1}
        )
        self.assertEqual(result["seed_sha256"], hashlib.sha256(seed.read_bytes()).hexdigest())
        self.assertEqual(
            self.connection.execute("select id::text from auth.users").fetchall(), [(user,)]
        )
        self.assertEqual(
            self.connection.execute("select id::text,name from public.companies").fetchall(),
            [(company, name)],
        )
        self.assertEqual(
            self.connection.execute(
                "select id::text from private.settlement_acquisitions"
            ).fetchall(),
            [(acquisition,)],
        )
        self.assertEqual(
            self.connection.execute("show session_replication_role").fetchone(), ("origin",)
        )

    def test_copy_errors_are_redacted_and_roll_back_prior_copy_rows(self) -> None:
        source_copy, acquisition = self.acquisition_copy()
        existing = new_id()
        self.connection.execute(
            "insert into public.companies(id,name) values (%s,'Existing')", (existing,)
        )
        self.connection.commit()
        private_cell, credential = "private-row-marker", "private-credential-marker"
        failed_source = source_copy.replace(acquisition, private_cell + credential, 1)
        failed_auth = (
            "COPY auth.users (id,encrypted_password) FROM stdin;\n"
            f"{private_cell}\t{credential}\n\\.\n"
        )
        for label, failed_block in (("source", failed_source), ("auth", failed_auth)):
            with self.subTest(label=label):
                seed = self.seed_file(self.company_copy() + failed_block)
                try:
                    load_financial_seed(self.connection, seed)
                except ValueError as error:
                    self.assertRegex(
                        str(error), r"Seed COPY import failed \(SQLSTATE [A-Z0-9]{5}\)"
                    )
                    self.assertTrue(error.__suppress_context__)
                    diagnostic = "".join(traceback.format_exception(error))
                    self.assertNotIn(private_cell, diagnostic)
                    self.assertNotIn(credential, diagnostic)
                else:
                    self.fail("Invalid COPY cells must reject the complete seed import")
                self.assertEqual(
                    self.connection.execute("select id::text from public.companies").fetchall(),
                    [(existing,)],
                )
                self.assertEqual(
                    self.connection.execute(
                        "select count(*) from private.settlement_acquisitions"
                    ).fetchone(),
                    (0,),
                )
                self.assertEqual(
                    self.connection.execute("select count(*) from auth.users").fetchone(), (0,)
                )
                self.assertEqual(
                    self.connection.execute("show session_replication_role").fetchone(), ("origin",)
                )

    def test_malformed_auth_rows_are_redacted_and_rolled_back(self) -> None:
        credential = "private-password-cell"
        seed = self.seed_file(
            self.company_copy()
            + "COPY auth.users (id,encrypted_password,raw_user_meta_data) FROM stdin;\n"
            + f"{new_id()}\t{credential}\n\\.\n"
        )
        with self.assertRaisesRegex(ValueError, "malformed Auth COPY row") as error:
            load_financial_seed(self.connection, seed)
        self.assertNotIn(credential, str(error.exception))
        self.assertEqual(
            self.connection.execute("select count(*) from public.companies").fetchone(), (0,)
        )
        self.assertEqual(
            self.connection.execute("show session_replication_role").fetchone(), ("origin",)
        )

    def test_non_disposable_database_guard_runs_before_opening_the_seed(self) -> None:
        connection = Mock()
        connection.execute.return_value.fetchall.return_value = [("postgres",)]
        with self.assertRaisesRegex(ValueError, "disposable test database"):
            load_financial_seed(cast(Connection, connection), Path("not-opened.sql"))
        connection.execute.assert_called_once_with("select current_database()")
        connection.cursor.assert_not_called()
        connection.transaction.assert_not_called()
