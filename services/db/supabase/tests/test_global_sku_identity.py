"""Exact SKU text is the global ownership, fee, and frontend selection identity."""

from decimal import Decimal
from typing import cast

from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    generate_payout_reports,
)


class GlobalSkuIdentityTests(FinancialFixture):
    def shared_sources(self) -> tuple[str, str, str, str]:
        company, identity = self.owner("S1")
        other, _ = self.owner("s1")
        self.assign("S1 ", other, rate="0")
        terms = self.fee(identity, [("2026-01-01", None, "5")])
        for seller, amount, cost in (("N1", "100", "-10"), ("N2", "200", "-20")):
            self.seller = seller
            acquisition = self.acquisition()
            _, old = self.settlement(
                [self.transaction("1000", sku="S1")], acquisition_id=acquisition
            )
            self.settlement(
                [
                    self.transaction(amount, sku="S1"),
                    self.transaction("10", 4, sku="s1"),
                    self.transaction("20", 5, sku="S1 "),
                ],
                acquisition_id=acquisition,
                expected=old,
            )
            _, old_day = self.kiosk(1, [self.component("-1000", sku="S1")])
            self.kiosk(2, [self.component(cost, sku="S1")], expected=old_day)
        return company, other, identity, terms

    def assert_shared_reads(self, user: str, expected_fee: str, company: str) -> None:
        result = cast(
            dict[str, object],
            self.as_user(
                user,
                "select public.transaction_page(p_skus=>array['S1'],p_limit=>100)",
            )[0][0],
        )
        rows = cast(list[dict[str, object]], result["rows"])
        self.assertEqual(result["total_count"], "4")
        self.assertEqual({row["sku"] for row in rows}, {"S1"})
        self.assertEqual({row["company_id"] for row in rows}, {company})
        self.assertEqual(
            {(row["source"], row["seller_namespace"]) for row in rows},
            {
                ("SETTLEMENT", "N1"),
                ("SETTLEMENT", "N2"),
                ("DATA_KIOSK", "N1"),
                ("DATA_KIOSK", "N2"),
            },
        )
        self.assertEqual(
            self.as_user(user, "select public.transaction_count(p_skus=>array['S1'])"),
            [("4",)],
        )
        totals = cast(
            dict[str, object],
            self.as_user(
                user,
                "select public.transaction_totals(p_date_from=>'2026-06-01',p_skus=>array['S1'])",
            )[0][0],
        )
        total = cast(list[dict[str, str]], totals["rows"])[0]
        self.assertEqual(total["row_count"], "4")
        self.assertEqual(Decimal(total["reported_amount"]), Decimal(270))
        self.assertEqual(Decimal(total["service_fee"]), Decimal(expected_fee))
        self.assertEqual(Decimal(total["company_amount"]), Decimal(270) + Decimal(expected_fee))
        self.assertEqual(
            sum(Decimal(cast(str, row["fee_amount"])) for row in rows), Decimal(expected_fee)
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
        member, other_member, operator = self.member(company), self.member(other), self.operator()
        self.assert_shared_reads(member, "-15", company)
        self.assert_shared_reads(operator, "-15", company)
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
                "select id::text from public.sku_terms_versions where sku_id=%s",
                (identity,),
            ),
            [(reassigned,)],
        )
        self.assertEqual(
            self.connection.execute(
                "select fee_rate_percent from public.sku_fee_periods where terms_version_id=%s",
                (original,),
            ).fetchall(),
            [(Decimal(5),)],
        )
        self.assertEqual(
            self.connection.execute("select count(*) from public.skus where sku='S1'").fetchone(),
            (1,),
        )

    def test_current_member_source_pages_combine_namespaces_without_exposing_history(self) -> None:
        company, other, _, _ = self.shared_sources()
        member, operator = self.member(company), self.operator()
        for dataset in ("settlement", "data_kiosk"):
            for user, expected in ((member, "2"), (operator, "4"), (self.member(other), "0")):
                with self.subTest(dataset=dataset, user=user):
                    page = cast(
                        dict[str, object],
                        self.as_user(
                            user,
                            "select public.source_transaction_page(%s,p_skus=>array['S1'])",
                            (dataset,),
                        )[0][0],
                    )
                    self.assertEqual(page["total_count"], expected)
                    self.assertEqual(
                        self.as_user(
                            user,
                            "select public.source_transaction_count(%s,p_skus=>array['S1'])",
                            (dataset,),
                        ),
                        [(expected,)],
                    )
        self.assertEqual(
            self.connection.execute(
                "select table_name,column_name from information_schema.columns "
                "where table_schema='public' and table_name in "
                "('skus','company_skus','current_sku_fee_periods') "
                "and column_name='seller_namespace'"
            ).fetchall(),
            [],
        )

    def test_monthly_payout_discovers_every_source_namespace_for_one_assignment(self) -> None:
        company, identity = self.owner("S1")
        self.fee(identity, [("2026-01-01", None, "5")])
        for seller, amount, cost in (("N1", "100", "-10"), ("N2", "200", "-20")):
            self.seller = seller
            self.settlement([self.transaction(amount, sku="S1")])
            self.kiosk(1, [self.component(cost, sku="S1")])
            fill_payout_kiosk_month(self)
        operator = self.operator()
        reports = generate_payout_reports(self, operator, company)
        self.assertEqual(len(reports), 2)
        self.assertTrue(all(created for _, created in reports))
        self.assertEqual(
            self.connection.execute(
                "select seller_namespace,source_amount,fee_amount,company_amount,"
                "terms_version_count "
                "from public.company_payout_reports where company_id=%s order by seller_namespace",
                (company,),
            ).fetchall(),
            [
                ("N1", Decimal(90), Decimal(-5), Decimal(85), 1),
                ("N2", Decimal(180), Decimal(-10), Decimal(170), 1),
            ],
        )
        self.assertEqual(
            self.connection.execute(
                "select distinct sku_id::text from private.payout_report_terms_versions"
            ).fetchall(),
            [(identity,)],
        )
        self.assertEqual(
            generate_payout_reports(self, operator, company),
            [(report, False) for report, _ in reports],
        )
        self.fee(identity, [("2026-01-01", None, "7")])
        revised = generate_payout_reports(self, operator, company)
        self.assertEqual(len(revised), 2)
        self.assertTrue(all(created for _, created in revised))
        self.assertEqual(
            self.connection.execute(
                "select company_amount from public.company_payout_reports "
                "where id=any(%s::uuid[]) order by seller_namespace",
                ([report for report, _ in revised],),
            ).fetchall(),
            [(Decimal(83),), (Decimal(166),)],
        )
        self.assertEqual(
            self.connection.execute(
                "select company_amount from public.company_payout_reports "
                "where id=any(%s::uuid[]) order by seller_namespace",
                ([report for report, _ in reports],),
            ).fetchall(),
            [(Decimal(85),), (Decimal(170),)],
        )
