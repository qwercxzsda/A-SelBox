"""Frozen marketplace summaries stay exact, complete, and scoped to saved reports."""

from decimal import Decimal

from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    generate_payout_reports,
    prepare_payout,
    publish_payout,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutMarketplaceTotalsTests(SourceModelFixture):
    def marketplace_totals(self, user: str, report: str | None = None) -> list[tuple[object, ...]]:
        return self.as_user(
            user,
            "select report_id::text,marketplace_name,source_amount,fee_amount,company_amount "
            "from public.payout_report_marketplace_totals "
            "where %s::uuid is null or report_id=%s::uuid "
            "order by report_id,marketplace_name nulls first",
            (report, report),
        )

    def test_full_frozen_breakdown_excludes_details_and_enforces_company_access(self) -> None:
        inputs = prepare_payout(self)
        other_company, other_sku = self.owner("OTHER")
        self.fee(other_sku, [("2026-01-01", None, "5")])
        _, settlement_version = self.settlement(
            [self.transaction("0.10", line) for line in range(3, 58)]
            + [
                self.transaction("0.123456789123456789", 58, kind="Adjustment")
                | {"marketplace_name": "Amazon.ca"},
                self.transaction("-0.03", 59, kind="Adjustment") | {"marketplace_name": None},
                self.transaction("99", 60, sku="OTHER"),
            ],
            acquisition_id=inputs.acquisition,
            expected=inputs.settlement_version,
        )
        _, kiosk_version = self.kiosk(
            2,
            [
                self.component("-0.23"),
                self.component("12345", category="ANALYSIS_ONLY"),
                self.component("3", category="ANALYSIS_ONLY") | {"quantity": "3"},
            ],
            expected=inputs.kiosk_version,
        )
        fill_payout_kiosk_month(self, marketplace="Amazon.ca")
        report = publish_payout(self, inputs)
        other_report = publish_payout(self, inputs, company_id=other_company)
        operator, member, other_member = (
            self.operator(),
            self.member(inputs.company),
            self.member(other_company),
        )
        expected = [
            (report, None, Decimal("-0.03"), Decimal(0), Decimal("-0.03")),
            (
                report,
                "Amazon.ca",
                Decimal("0.123456789123456789"),
                Decimal(0),
                Decimal("0.123456789123456789"),
            ),
            (report, "Amazon.com", Decimal("5.27"), Decimal("-0.275"), Decimal("4.995")),
        ]
        other_expected = [
            (other_report, "Amazon.com", Decimal(99), Decimal("-4.95"), Decimal("94.05"))
        ]
        self.assertEqual(self.marketplace_totals(member), expected)
        self.assertEqual(self.marketplace_totals(other_member), other_expected)
        self.assertEqual(self.marketplace_totals(member, other_report), [])
        self.assertEqual(self.marketplace_totals(other_member, report), [])
        self.assertCountEqual(self.marketplace_totals(operator), expected + other_expected)
        self.assertEqual(
            self.connection.execute(
                "select count(*) filter(where authoritative),"
                "count(*) filter(where not authoritative),"
                "count(*) filter(where not authoritative and fee_amount is null "
                "and company_amount is null) "
                "from public.company_payout_report_components where report_id=%s",
                (report,),
            ).fetchone(),
            (58, 2, 2),
        )
        self.assertEqual(
            self.connection.execute(
                "select sum(m.source_amount)=r.source_amount,sum(m.fee_amount)=r.fee_amount,"
                "sum(m.company_amount)=r.company_amount "
                "from public.payout_report_marketplace_totals m "
                "join public.company_payout_reports r on r.id=m.report_id where r.id=%s "
                "group by r.id",
                (report,),
            ).fetchone(),
            (True, True, True),
        )
        self.fee(inputs.sku_identity, [("2026-01-01", None, "15")])
        self.settlement(
            [self.transaction("1000")],
            acquisition_id=inputs.acquisition,
            expected=settlement_version,
        )
        self.kiosk(3, [self.component("-500")], expected=kiosk_version)
        self.assertEqual(self.marketplace_totals(member, report), expected)
        self.assertEqual(self.marketplace_totals(other_member, other_report), other_expected)
        self.connection.execute("set constraints all immediate")

    def test_company_month_generation_returns_every_currency_scope(self) -> None:
        inputs = prepare_payout(self)
        self.kiosk(
            2,
            [self.component("-10"), self.component("-7.25") | {"currency": "EUR"}],
            expected=inputs.kiosk_version,
        )
        operator = self.operator()
        reports = generate_payout_reports(self, inputs.company)
        self.assertEqual(len(reports), 2)
        self.assertTrue(all(created for _, created in reports))
        self.assertEqual(
            self.as_user(
                operator,
                "select r.currency,m.marketplace_name,m.source_amount,"
                "m.fee_amount,m.company_amount "
                "from public.company_payout_reports r "
                "join public.payout_report_marketplace_totals m on m.report_id=r.id "
                "where r.company_id=%s order by r.currency",
                (inputs.company,),
            ),
            [
                ("EUR", "Amazon.com", Decimal("-7.25"), Decimal(0), Decimal("-7.25")),
                ("USD", "Amazon.com", Decimal(90), Decimal(-5), Decimal(85)),
            ],
        )
        self.connection.execute("set constraints all immediate")
