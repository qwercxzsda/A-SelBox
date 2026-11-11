"""Market-specific snapshots keep exact units, source evidence, and zero-activity scopes."""

from datetime import date
from decimal import Decimal

import psycopg

from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    generate_payout_reports,
    payout_snapshot,
    prepare_payout,
    report_source_rows,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id
from services.db.supabase.tests.verification.payout_source_parity import verify_payout_source_parity
from services.db.supabase.tests.verification.payouts import independent_payout_totals


class PayoutMarketplaceScopeTests(SourceModelFixture):
    def test_same_currency_markets_have_separate_exact_reports_and_controls(self) -> None:
        inputs = prepare_payout(self)
        self.finances(
            [
                self.transaction("100"),
                self.transaction("0.123456789123456789", 4, kind="Adjustment")
                | {"marketplace_name": "Amazon.ca"},
            ],
        )
        fill_payout_kiosk_month(self, marketplace="Amazon.ca")
        generated = generate_payout_reports(self, inputs.company)
        self.assertEqual(len(generated), 2)
        self.assertTrue(all(created for _, created in generated))
        reports = self.connection.execute(
            "select id::text,marketplace_name,currency,source_amount,"
            "fee_amount,company_amount from public.company_payout_reports "
            "where company_id=%s order by marketplace_name",
            (inputs.company,),
        ).fetchall()
        self.assertEqual(
            [row[1:] for row in reports],
            [
                (
                    "Amazon.ca",
                    "USD",
                    Decimal("0.123456789123456789"),
                    Decimal(0),
                    Decimal("0.123456789123456789"),
                ),
                (
                    "Amazon.com",
                    "USD",
                    Decimal(90),
                    Decimal(-5),
                    Decimal(85),
                ),
            ],
        )
        for report, market, currency, source, fee, amount in reports:
            with self.subTest(market=market):
                self.assertEqual(
                    independent_payout_totals(self.connection, report), (source, fee, amount)
                )
                self.assertEqual(
                    self.connection.execute(
                        "select distinct marketplace_name "
                        "from private.read_payout_report_records(%s)",
                        (report,),
                    ).fetchall(),
                    [(market,)],
                )
                self.assertEqual(
                    {
                        (row["marketplace_name"], row["currency"])
                        for row in report_source_rows(self, self.administrator(), report)
                    },
                    {(market, currency)},
                )
        member, other = self.member(inputs.company), self.member(self.owner("OTHER")[0])
        self.assertCountEqual(
            self.as_user(member, "select id::text from public.latest_company_payout_reports"),
            [(report,) for report, _ in generated],
        )
        self.assertEqual(
            self.as_user(other, "select * from public.latest_company_payout_reports"), []
        )
        self.assertEqual(
            generate_payout_reports(self, inputs.company),
            [(report, False) for report, _ in generated],
        )
        parity = verify_payout_source_parity(self.connection, self.administrator())
        self.assertEqual(parity["company_marketplace_currency_reports"], 2)
        self.connection.execute("set constraints all immediate")

    def test_one_market_with_multiple_currencies_never_combines_money_or_controls(self) -> None:
        inputs = prepare_payout(self)
        self.kiosk(
            2,
            [self.component("-10"), self.component("-7.25") | {"currency": "EUR"}],
            expected=inputs.kiosk_version,
        )
        generated = generate_payout_reports(self, inputs.company)
        self.assertEqual(len(generated), 2)
        self.assertEqual(
            self.connection.execute(
                "select marketplace_name,currency,company_amount "
                "from public.latest_company_payout_reports "
                "where company_id=%s order by currency",
                (inputs.company,),
            ).fetchall(),
            [("Amazon.com", "EUR", Decimal("-7.25")), ("Amazon.com", "USD", Decimal(85))],
        )
        administrator = self.administrator()
        for report, _ in generated:
            scope = self.connection.execute(
                "select marketplace_name,currency from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone()
            self.assertTrue(report_source_rows(self, administrator, report))
            self.assertTrue(
                all(
                    (row["marketplace_name"], row["currency"]) == scope
                    for row in report_source_rows(self, administrator, report)
                )
            )
        self.connection.execute("set constraints all immediate")

    def test_zero_market_gets_new_snapshot_without_changing_its_old_report(self) -> None:
        inputs = prepare_payout(self)
        self.finances(
            [
                self.transaction("100"),
                self.transaction("12", 4, kind="Adjustment") | {"marketplace_name": "Amazon.ca"},
            ],
        )
        fill_payout_kiosk_month(self, marketplace="Amazon.ca")
        generated = generate_payout_reports(self, inputs.company)
        old = generated[0][0]  # Natural market order: Amazon.ca before Amazon.com.
        before = payout_snapshot(self, old)
        acquisition = self.acquisition(
            marketplace="Amazon.ca",
            marketplace_id="A2EUQ1WTGCTBG2",
            time_zone="America/Los_Angeles",
        )
        self.finances(
            [self.transaction("0", 4, kind="Adjustment") | {"marketplace_name": "Amazon.ca"}],
            acquisition_id=acquisition,
        )
        replacement = generate_payout_reports(self, inputs.company)
        self.assertEqual(len(replacement), 2)
        self.assertEqual(
            self.connection.execute(
                "select marketplace_name,currency,company_amount,component_count "
                "from public.latest_company_payout_reports "
                "where company_id=%s order by marketplace_name",
                (inputs.company,),
            ).fetchall(),
            [("Amazon.ca", "USD", Decimal(0), 1), ("Amazon.com", "USD", Decimal(85), 2)],
        )
        self.assertEqual(payout_snapshot(self, old), before)
        self.connection.execute("set constraints all immediate")

    def test_empty_market_scope_is_explicit_and_invalid_or_missing_markets_are_rejected(
        self,
    ) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        company, _ = self.owner()
        payload: dict[str, object] = {
            "id": new_id(),
            "company_id": company,
            "marketplace_name": None,
            "currency": None,
            "start_date": "2026-06-01",
            "end_date": "2026-06-30",
            "dataset_key": "economics",
            "report_name": "Empty June",
            "change_reason": "No activity",
        }
        report = self.call("publish_company_payout_report", payload)
        self.assertEqual(generate_payout_reports(self, company), [(report, False)])
        self.assertEqual(
            self.connection.execute(
                "select marketplace_name,currency,company_amount "
                "from public.latest_company_payout_reports "
                "where company_id=%s",
                (company,),
            ).fetchall(),
            [(None, None, Decimal(0))],
        )
        for marketplace in ("", "unknown", " Amazon.com", "Amazon.de,Amazon.fr"):
            with (
                self.subTest(marketplace=marketplace),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.call(
                    "publish_company_payout_report",
                    payload
                    | {
                        "id": new_id(),
                        "marketplace_name": marketplace,
                    },
                )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.call(
                "publish_company_payout_report",
                {key: value for key, value in payload.items() if key != "marketplace_name"}
                | {"id": new_id()},
            )
        self.connection.execute("set constraints all immediate")

    def test_deferred_validation_rejects_revision_inputs_from_a_different_market(self) -> None:
        inputs = prepare_payout(self)
        _, other_version = self.finances(
            [self.transaction("10", 4) | {"marketplace_name": "Amazon.ca"}]
        )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            report = self.call(
                "publish_company_payout_report",
                {
                    "id": new_id(),
                    "company_id": inputs.company,
                    "marketplace_name": "Amazon.com",
                    "currency": "USD",
                    "start_date": "2026-06-01",
                    "end_date": "2026-06-30",
                    "dataset_key": "economics",
                    "report_name": "Scope validation",
                    "change_reason": "Reject an out-of-scope pinned revision",
                },
            )
            self.connection.execute(
                "alter table private.payout_report_finances_versions disable trigger immutable"
            )
            self.connection.execute(
                "update private.payout_report_finances_versions p "
                "set transaction_id=v.transaction_id,version_id=v.id "
                "from private.finances_transaction_versions v "
                "where v.id=%s and p.report_id=%s",
                (other_version, report),
            )
            self.connection.execute("set constraints all immediate")
