"""Published evidence stays immutable and rejects invalid report references."""

from typing import cast

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from services.db.supabase.tests import test_company_payout_reports as payout_fixture
from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class EvidenceIntegrityTests(SourceModelFixture):
    report = payout_fixture.CompanyPayoutReportTests.report

    def published_evidence(self) -> tuple[str, str, str, str]:
        company, identity = self.owner()
        _, other_identity = self.owner("OTHER")
        self.fee(identity, [("2026-01-01", None, "5")])
        other_terms = self.fee(other_identity, [("2026-01-01", None, "5")])
        other_period = str(
            require_row(
                self.connection.execute(
                    "select id from public.sku_fee_periods where terms_version_id=%s",
                    (other_terms,),
                ).fetchone()
            )[0]
        )
        settlement, _ = self.settlement([self.transaction("100")])
        report = self.report(company, [settlement])
        self.connection.execute("set constraints all immediate")
        return report, other_identity, other_terms, other_period

    def test_source_and_terms_parent_mutations_are_rejected_before_fk_checks(self) -> None:
        self.published_evidence()
        for schema, table in (
            ("private", "settlement_acquisitions"),
            ("private", "settlement_preprocess_versions"),
            ("public", "sku_terms_versions"),
            ("public", "sku_fee_periods"),
        ):
            relation = sql.Identifier(schema, table)
            statements = (
                sql.SQL("update {} set id=id").format(relation),
                sql.SQL("delete from {}").format(relation),
                sql.SQL("truncate {} cascade").format(relation),
            )
            for statement in statements:
                with (
                    self.subTest(table=table, statement=statement.as_string(self.connection)),
                    self.assertRaisesRegex(psycopg.errors.CheckViolation, "immutable"),
                    self.connection.transaction(),
                ):
                    self.connection.execute(statement)

    def test_report_components_reject_missing_and_misbound_foreign_keys(self) -> None:
        report, other_identity, other_terms, other_period = self.published_evidence()
        # OTHER has real terms and a real fee period, but neither belongs to the
        # report's SKU/terms/manifest. A valid UUID alone cannot establish a link.
        changes = (
            {"report_id": new_id()},
            {"seller_sku_id": new_id()},
            {"terms_version_id": new_id()},
            {"fee_period_id": new_id()},
            {"seller_sku_id": other_identity},
            {"fee_period_id": other_period},
            {
                "seller_sku_id": other_identity,
                "terms_version_id": other_terms,
                "fee_period_id": other_period,
            },
        )
        for change in changes:
            with (
                self.subTest(changed_fields=tuple(change)),
                self.assertRaises(psycopg.errors.ForeignKeyViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "insert into public.company_payout_report_components "
                    "select (jsonb_populate_record(null::public.company_payout_report_components, "
                    "to_jsonb(c)||%s::jsonb)).* "
                    "from public.company_payout_report_components c where c.report_id=%s",
                    (
                        Jsonb(
                            cast(dict[str, object], change)
                            | {
                                "id": new_id(),
                                "row_number": 2,
                                "source_row_id": new_id(),
                            }
                        ),
                        report,
                    ),
                )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_report_components where report_id=%s",
                (report,),
            ).fetchone(),
            (1,),
        )
