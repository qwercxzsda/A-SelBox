"""Exact SKU text is the global ownership, fee, and frontend selection identity."""

from decimal import Decimal

from services.db.supabase.tests.financial_fixtures import FinancialFixture


class GlobalSkuIdentityTests(FinancialFixture):
    def shared_sources(self) -> tuple[str, str, str, str]:
        company, identity = self.owner("S1")
        other, _ = self.owner("S1 ")
        self.assign("s1", other)
        original = self.fee(identity, [("2026-01-01", None, "5")])
        for seller, amount in (("north", "100"), ("south", "200")):
            self.seller = seller
            self.finances([self.transaction(amount, sku="S1")])
        return company, other, identity, original

    def assert_shared_reads(self, user: str, fee: str, company: str) -> None:
        self.assertEqual(
            self.as_user(
                user,
                "select count(*),sum(fee_amount) from public.live_company_components "
                "where sku='S1' and company_id=%s",
                (company,),
            ),
            [(2, Decimal(fee))],
        )

    def assert_shared_hidden(self, user: str) -> None:
        self.assertEqual(
            self.as_user(user, "select public.transaction_count(p_skus=>array['S1'])"),
            [("0",)],
        )
        for query in (
            "select public.transaction_page(p_skus=>array['S1'])->'rows'",
            "select public.transaction_totals("
            "p_date_from=>'2026-06-01',p_skus=>array['S1'])->'rows'",
        ):
            self.assertEqual(self.as_user(user, query), [([],)])

    def test_one_assignment_combines_sources_fees_and_reassignment_for_exact_sku(self) -> None:
        company, other, identity, original = self.shared_sources()
        member, other_member, administrator = (
            self.member(company),
            self.member(other),
            self.administrator(),
        )
        self.assert_shared_reads(member, "-15", company)
        self.assert_shared_reads(administrator, "-15", company)
        self.assert_shared_hidden(other_member)
        self.assertEqual(self.as_user(member, "select sku from public.company_skus"), [("S1",)])
        self.assertEqual(
            self.as_user(
                other_member, 'select sku from public.company_skus order by sku collate "C"'
            ),
            [("S1 ",), ("s1",)],
        )
        corrected = self.fee(identity, [("2026-01-01", None, "7")])
        self.assert_shared_reads(member, "-21", company)
        reassigned = self.assign("S1", other, rate="10", expected=corrected)
        self.assert_shared_hidden(member)
        self.assert_shared_reads(other_member, "-30", other)
        self.assertEqual(
            self.as_user(
                other_member,
                "select id::text from public.assignment_versions where key_id=%s",
                (identity,),
            ),
            [(reassigned,)],
        )
        self.assertEqual(
            self.connection.execute(
                "select fee_rate_percent from public.sku_fee_periods where "
                "assignment_version_id=%s",
                (original,),
            ).fetchall(),
            [(Decimal(5),)],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.assignment_keys where kind='SKU' and native_id='S1'"
            ).fetchone(),
            (1,),
        )
