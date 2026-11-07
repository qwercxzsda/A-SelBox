"""Frozen report totals match authoritative components and retain exact marketplace units."""

from decimal import Decimal
from typing import cast

from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    generate_payout_reports,
    prepare_payout,
    publish_payout,
    report_records,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutComponentTotalsTests(SourceModelFixture):
    def report_totals(self, user: str, report: str | None = None) -> list[tuple[object, ...]]:
        return self.as_user(
            user,
            "select id::text,marketplace_name,source_amount,fee_amount,company_amount "
            "from public.company_payout_reports "
            "where %s::uuid is null or id=%s::uuid order by id",
            (report, report),
        )

    def test_complete_totals_exclude_supporting_rows_and_enforce_company_access(self) -> None:
        inputs = prepare_payout(self)
        other_company, other_sku = self.owner("OTHER")
        self.fee(other_sku, [("2026-01-01", None, "5")])
        finances_rows = [self.transaction("0.10", line) for line in range(3, 58)] + [
            self.transaction("0.123456789123456789", 58, kind="Adjustment")
            | {"marketplace_name": "Amazon.ca"},
            self.transaction("-0.03", 59, kind="Adjustment") | {"marketplace_name": "Amazon.ca"},
            self.transaction("99", 60, sku="OTHER"),
        ]
        self.finances(finances_rows)
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
        canada_report = publish_payout(self, inputs, marketplace_name="Amazon.ca")
        other_report = publish_payout(self, inputs, company_id=other_company)
        administrator, member, other_member = (
            self.administrator(),
            self.member(inputs.company),
            self.member(other_company),
        )
        expected = [
            (
                canada_report,
                "Amazon.ca",
                Decimal("0.093456789123456789"),
                Decimal(0),
                Decimal("0.093456789123456789"),
            ),
            (report, "Amazon.com", Decimal("5.27"), Decimal("-0.275"), Decimal("4.995")),
        ]
        other_expected = [
            (other_report, "Amazon.com", Decimal(99), Decimal("-4.95"), Decimal("94.05"))
        ]
        self.assertCountEqual(self.report_totals(member), expected)
        self.assertEqual(self.report_totals(other_member), other_expected)
        self.assertEqual(self.report_totals(member, other_report), [])
        self.assertEqual(self.report_totals(other_member, report), [])
        self.assertCountEqual(self.report_totals(administrator), expected + other_expected)
        self.assertEqual(
            self.connection.execute(
                "select count(*) filter(where authoritative),"
                "count(*) filter(where not authoritative),"
                "count(*) filter(where not authoritative and fee_amount is null "
                "and company_amount is null) "
                "from private.read_payout_report_records(%s)",
                (report,),
            ).fetchone(),
            (56, 2, 2),
        )
        self.assertEqual(
            self.connection.execute(
                "select sum(c.source_amount) filter(where c.authoritative)=r.source_amount,"
                "sum(c.fee_amount) filter(where c.authoritative)=r.fee_amount,"
                "sum(c.company_amount) filter(where c.authoritative)=r.company_amount "
                "from public.company_payout_reports r "
                "cross join lateral private.read_payout_report_records(r.id) c where r.id=%s "
                "group by r.id",
                (report,),
            ).fetchone(),
            (True, True, True),
        )
        record_snapshots: dict[str, list[dict[str, object]]] = {}
        for user, expected_count in ((administrator, 56), (member, 56)):
            records: list[dict[str, object]] = []
            for offset in range(0, expected_count, 17):
                page = cast(
                    dict[str, object],
                    self.as_user(
                        user,
                        "select public.payout_report_records(%s,true,17,%s)",
                        (report, offset),
                    )[0][0],
                )
                self.assertEqual(page["total_count"], str(expected_count))
                records.extend(cast(list[dict[str, object]], page["rows"]))
            identities = {
                (row["report_id"], row["source"], row["source_row_id"]) for row in records
            }
            self.assertEqual(len(identities), expected_count)
            self.assertTrue(all("id" not in row and "created_at" not in row for row in records))
            self.assertEqual(records, report_records(self, report, user=user, authoritative=True))
            record_snapshots[user] = records
            selected = cast(
                dict[str, object],
                self.as_user(
                    user,
                    "select public.payout_report_records(%s,true,1,0,array['FbaStorageFee'])",
                    (report,),
                )[0][0],
            )
            self.assertEqual(selected["total_count"], "1")
            self.assertEqual(
                [row["source_amount"] for row in cast(list[dict[str, str]], selected["rows"])],
                ["-0.23"],
            )
        self.fee(inputs.sku_identity, [("2026-01-01", None, "15")])
        finances_rows[0] = finances_rows[0] | {"amount": "1000", "fee_base": "1000"}
        self.finances(finances_rows)
        self.kiosk(3, [self.component("-500")], expected=kiosk_version)
        self.assertEqual(self.report_totals(member, report), [expected[1]])
        self.assertEqual(self.report_totals(member, canada_report), [expected[0]])
        self.assertEqual(self.report_totals(other_member, other_report), other_expected)
        for user, records in record_snapshots.items():
            self.assertEqual(report_records(self, report, user=user, authoritative=True), records)
        self.connection.execute("set constraints all immediate")

    def test_company_month_generation_returns_every_currency_scope(self) -> None:
        inputs = prepare_payout(self)
        self.kiosk(
            2,
            [self.component("-10"), self.component("-7.25") | {"currency": "EUR"}],
            expected=inputs.kiosk_version,
        )
        administrator = self.administrator()
        reports = generate_payout_reports(self, inputs.company)
        self.assertEqual(len(reports), 2)
        self.assertTrue(all(created for _, created in reports))
        self.assertEqual(
            self.as_user(
                administrator,
                "select r.currency,r.marketplace_name,r.source_amount,"
                "r.fee_amount,r.company_amount "
                "from public.company_payout_reports r "
                "where r.company_id=%s order by r.currency",
                (inputs.company,),
            ),
            [
                ("EUR", "Amazon.com", Decimal("-7.25"), Decimal(0), Decimal("-7.25")),
                ("USD", "Amazon.com", Decimal(90), Decimal(-5), Decimal(85)),
            ],
        )
        self.connection.execute("set constraints all immediate")
