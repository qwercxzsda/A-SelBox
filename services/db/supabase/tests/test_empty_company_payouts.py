"""Explicit empty snapshots use the normal publisher without inventing a currency."""

from datetime import date
from decimal import Decimal

import psycopg

from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    generate_payout_reports,
    payout_snapshot,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class EmptyCompanyPayoutTests(SourceModelFixture):
    def setUp(self) -> None:
        super().setUp()
        self.set_mature_cutoff_date(date(2026, 7, 1))

    def company_without_skus(self) -> str:
        company = new_id()
        self.connection.execute(
            "insert into public.companies(id,name) values (%s,'Empty company')", (company,)
        )
        return company

    def report_count(self) -> int:
        row = self.connection.execute(
            "select count(*) from public.company_payout_reports"
        ).fetchone()
        if row is None:
            self.fail("Expected report count.")
        return int(row[0])

    def assert_empty_scope(self, report: str, inventories: tuple[int, int, int]) -> None:
        self.assertEqual(
            self.connection.execute(
                "select seller_namespace,currency,preprocess_version,source_amount,fee_amount,"
                "company_amount,component_count,reconciliation_count,settlement_version_count,"
                "data_kiosk_version_count,terms_version_count "
                "from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (None, None, None, Decimal(0), Decimal(0), Decimal(0), 0, 0, *inventories),
        )

    def test_unrelated_source_data_does_not_prevent_empty_company_snapshot_and_reuse(self) -> None:
        company = self.company_without_skus()
        self.seller = "unrelated-seller"
        self.settlement([self.transaction("100", sku="UNASSIGNED")])
        operator, member = self.operator(), self.member(company)
        self.assertEqual(self.report_count(), 0)
        report, created = generate_payout_reports(self, operator, company)[0]
        self.assertTrue(created)
        self.assert_empty_scope(report, (0, 0, 0))
        before = payout_snapshot(self, report)
        self.assertEqual(generate_payout_reports(self, operator, company), [(report, False)])
        self.assertEqual(payout_snapshot(self, report), before)
        self.assertEqual(self.report_count(), 1)
        self.assertEqual(
            self.as_user(member, "select id::text,currency from public.company_payout_reports"),
            [(report, None)],
        )
        other = self.member(self.company_without_skus())
        self.assertEqual(self.as_user(other, "select * from public.company_payout_reports"), [])
        self.assertEqual(
            self.as_user(member, "select * from public.payout_report_marketplace_totals"), []
        )
        self.connection.execute("set constraints all immediate")

    def test_available_empty_versions_and_terms_are_pinned_and_refresh_only_on_request(
        self,
    ) -> None:
        company, identity = self.owner()
        acquisition = self.acquisition()
        _, old_settlement = self.settlement([self.transaction("100")], acquisition_id=acquisition)
        _, settlement_version = self.settlement(
            [], acquisition_id=acquisition, expected=old_settlement
        )
        _, old_kiosk = self.kiosk(1, [self.component("-10")])
        _, kiosk_version = self.kiosk(2, [], expected=old_kiosk)
        operator = self.operator()
        report, created = generate_payout_reports(self, operator, company)[0]
        self.assertTrue(created)
        self.assert_empty_scope(report, (1, 1, 1))
        before = payout_snapshot(self, report)
        self.assertEqual(
            self.connection.execute(
                "select version_id::text from private.payout_report_settlement_versions "
                "where report_id=%s",
                (report,),
            ).fetchall(),
            [(settlement_version,)],
        )
        self.assertEqual(generate_payout_reports(self, operator, company), [(report, False)])
        _, replacement = self.kiosk(3, [], expected=kiosk_version)
        self.connection.commit()
        self.assertEqual(self.report_count(), 1)
        next_report, created = generate_payout_reports(self, operator, company)[0]
        self.assertTrue(created)
        self.assertNotEqual(next_report, report)
        self.assert_empty_scope(next_report, (1, 1, 1))
        self.assertEqual(
            self.connection.execute(
                "select version_id::text from private.payout_report_data_kiosk_versions "
                "where report_id=%s",
                (next_report,),
            ).fetchall(),
            [(replacement,)],
        )
        terms = self.fee(identity, [])
        self.connection.commit()
        self.assertEqual(self.report_count(), 2)
        final_report, created = generate_payout_reports(self, operator, company)[0]
        self.assertTrue(created)
        self.assertNotEqual(final_report, next_report)
        self.assertEqual(
            self.connection.execute(
                "select terms_version_id::text from private.payout_report_terms_versions "
                "where report_id=%s",
                (final_report,),
            ).fetchall(),
            [(terms,)],
        )
        self.assertEqual(generate_payout_reports(self, operator, company), [(final_report, False)])
        self.assertEqual(payout_snapshot(self, report), before)
        self.connection.execute("set constraints all immediate")

    def test_registered_sku_cannot_associate_unrelated_empty_source_metadata(self) -> None:
        company, _ = self.owner()
        self.settlement([])
        self.kiosk(1, [])
        operator = self.operator()
        report, created = generate_payout_reports(self, operator, company)[0]
        self.assertTrue(created)
        self.assert_empty_scope(report, (0, 0, 1))
        self.assertEqual(generate_payout_reports(self, operator, company), [(report, False)])
        self.connection.execute("set constraints all immediate")

    def test_archives_without_preprocessing_allow_an_explicit_empty_snapshot(self) -> None:
        company, _ = self.owner()
        self.acquisition()
        self.kiosk_acquisition(1)
        self.connection.commit()
        self.assertEqual(self.report_count(), 0)
        report, created = generate_payout_reports(self, self.operator(), company)[0]
        self.assertTrue(created)
        self.assert_empty_scope(report, (0, 0, 1))
        self.connection.execute("set constraints all immediate")

    def test_unassigned_amounts_for_related_seller_cannot_be_mislabeled_as_empty(self) -> None:
        company, _ = self.owner()
        acquisition = self.acquisition()
        _, previous = self.settlement([self.transaction("100")], acquisition_id=acquisition)
        self.settlement(
            [self.transaction("100", sku="UNASSIGNED")],
            acquisition_id=acquisition,
            expected=previous,
        )
        fill_payout_kiosk_month(self)
        with self.assertRaisesRegex(psycopg.errors.CheckViolation, "ownership"):
            generate_payout_reports(self, self.operator(), company)
        self.assertEqual(self.report_count(), 0)

    def test_explicit_requests_transition_empty_to_currencies_and_retain_removed_scopes(
        self,
    ) -> None:
        company, identity = self.owner()
        operator = self.operator()
        empty, _ = generate_payout_reports(self, operator, company)[0]
        empty_snapshot = payout_snapshot(self, empty)
        self.fee(identity, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, settlement_version = self.settlement(
            [self.transaction("100")], acquisition_id=acquisition
        )
        _, kiosk_version = self.kiosk(
            1, [self.component("-10"), self.component("-7.25") | {"currency": "EUR"}]
        )
        fill_payout_kiosk_month(self)
        self.connection.commit()
        self.assertEqual(self.report_count(), 1)
        paid_scopes = generate_payout_reports(self, operator, company)
        self.assertEqual(len(paid_scopes), 2)
        self.assertTrue(all(created for _, created in paid_scopes))
        self.assertEqual(
            self.connection.execute(
                "select currency from public.company_payout_reports "
                "where id=any(%s::uuid[]) order by currency",
                ([report for report, _ in paid_scopes],),
            ).fetchall(),
            [("EUR",), ("USD",)],
        )
        _, remaining_version = self.kiosk(2, [self.component("-10")], expected=kiosk_version)
        self.connection.commit()
        self.assertEqual(self.report_count(), 3)
        mixed = generate_payout_reports(self, operator, company)
        self.assertEqual(
            self.connection.execute(
                "select currency,company_amount,component_count from public.company_payout_reports "
                "where id=any(%s::uuid[]) order by currency",
                ([report for report, _ in mixed],),
            ).fetchall(),
            [("EUR", Decimal(0), 0), ("USD", Decimal(85), 2)],
        )
        self.settlement([], acquisition_id=acquisition, expected=settlement_version)
        self.kiosk(3, [], expected=remaining_version)
        self.connection.commit()
        self.assertEqual(self.report_count(), 5)
        removed = generate_payout_reports(self, operator, company)
        self.assertEqual(
            self.connection.execute(
                "select seller_namespace,currency,preprocess_version,source_amount,fee_amount,"
                "company_amount,component_count from public.company_payout_reports "
                "where id=any(%s::uuid[]) order by currency",
                ([report for report, _ in removed],),
            ).fetchall(),
            [
                (self.seller, "EUR", "v0", Decimal(0), Decimal(0), Decimal(0), 0),
                (self.seller, "USD", "v0", Decimal(0), Decimal(0), Decimal(0), 0),
            ],
        )
        self.assertEqual(
            generate_payout_reports(self, operator, company),
            [(report, False) for report, _ in removed],
        )
        self.assertEqual(payout_snapshot(self, empty), empty_snapshot)
        self.connection.execute("set constraints all immediate")
