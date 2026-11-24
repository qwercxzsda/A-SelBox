"""Explicit empty snapshots use the normal publisher without inventing a currency."""

from datetime import date

from services.db.supabase.tests.payout_fixtures import generate_payout_reports
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

    def test_company_without_assigned_skus_gets_no_report_despite_members_or_source_data(
        self,
    ) -> None:
        company = self.company_without_skus()
        self.seller = "unrelated-seller"
        self.finances([self.transaction("100", sku="UNASSIGNED")])
        member = self.member(company)
        self.assertEqual(self.report_count(), 0)
        self.assertEqual(generate_payout_reports(self, company), [])
        self.assertEqual(generate_payout_reports(self, company), [])
        self.assertEqual(self.report_count(), 0)
        self.assertEqual(
            self.as_user(member, "select id::text,currency from public.company_payout_reports"),
            [],
        )
        other = self.member(self.company_without_skus())
        self.assertEqual(self.as_user(other, "select * from public.company_payout_reports"), [])
        self.connection.execute("set constraints all immediate")

    def test_missing_assignment_is_a_difference_and_allows_empty_company_payout(self) -> None:
        company, _ = self.owner()
        acquisition = self.acquisition()
        original = self.transaction("100")
        self.finances([original], acquisition_id=acquisition)
        self.finances(
            [original | {"sku": "UNASSIGNED"}],
            acquisition_id=acquisition,
        )
        [(report, _)] = generate_payout_reports(self, company)
        member = self.member(company)
        for grouped in (False, True):
            self.assertEqual(
                self.as_user(
                    member, "select public.payout_report_totals(%s,%s)", (report, grouped)
                ),
                [({"rows": [], "next_offset": None},)],
            )
        self.assertEqual(
            self.connection.execute(
                "select record_count,company_amount from public.company_payout_reports"
            ).fetchone(),
            (0, 0),
        )
        self.assertEqual(
            self.connection.execute("select reason from private.financial_outcomes").fetchone(),
            ("NO_ASSIGNMENT",),
        )
