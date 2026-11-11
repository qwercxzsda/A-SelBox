"""Payout inputs are scoped immutable revisions, not capture or processing runs."""

from datetime import date
from decimal import Decimal

import psycopg
from psycopg.types.json import Jsonb

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    payout_snapshot,
    prepare_payout,
    publish_payout,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class PayoutRevisionSelectionTests(SourceModelFixture):
    def report(self, company: str) -> str:
        return self.call(
            "publish_company_payout_report",
            {
                "id": new_id(),
                "company_id": company,
                "marketplace_name": "Amazon.com",
                "currency": "USD",
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "dataset_key": "economics",
                "change_reason": "Record exact selected contents and successful coverage",
            },
        )

    def test_compatible_reprocessing_changes_labels_without_changing_report_identity(self) -> None:
        inputs = prepare_payout(self)
        report = publish_payout(self, inputs)
        before = payout_snapshot(self, report)
        self.finances([self.transaction("100")], version="v1")
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "preprocessing versions"),
            self.connection.transaction(),
        ):
            publish_payout(self, inputs)
        acquisition = self.kiosk_acquisition(2, start="2026-06-01", end="2026-06-30")
        days = [
            row[0]
            for row in self.connection.execute(
                "select jsonb_build_object("
                "'activity_date',d.activity_date,'marketplace_name',d.marketplace_name,"
                "'activity_at',v.activity_at,"
                "'expected_current_version_id',d.current_version_id,"
                "'expected_current_batch_id',d.current_batch_id,'content_sha256',v.content_sha256,"
                "'transactions',(select coalesce(jsonb_agg("
                "to_jsonb(c)-array['version_id','created_at']),"
                "'[]'::jsonb) from private.data_kiosk_day_components c where c.version_id=v.id)) "
                "from private.data_kiosk_days d join private.data_kiosk_day_versions v "
                "on v.id=d.current_version_id order by d.activity_date"
            ).fetchall()
        ]
        self.publish_kiosk_days(
            {
                "acquisition_id": acquisition,
                "preprocess_version": "v1",
                "dataset_key": "economics",
                "days": days,
            },
        )
        self.assertEqual(publish_payout(self, inputs), report)
        self.assertEqual(payout_snapshot(self, report), before)
        self.connection.execute("set constraints all immediate")

    def test_reports_store_totals_and_inputs_without_copied_details_or_calculator_versions(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        report = publish_payout(self, inputs)
        self.assertEqual(
            self.connection.execute(
                "select to_regclass('public.company_payout_report_components'),"
                "exists(select 1 from pg_attribute "
                "where attrelid='public.company_payout_reports'::regclass "
                "and attname='calculation_version' and not attisdropped)"
            ).fetchone(),
            (None, False),
        )
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount,component_count "
                "from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (90, -5, 85, 2),
        )

    def test_changed_partial_capture_can_mix_current_finance_revisions(self) -> None:
        inputs = prepare_payout(self)
        self.finances(
            [
                self.transaction("100"),
                self.transaction("50", 4, activity_date="2026-06-16"),
            ]
        )
        first = publish_payout(self, inputs)
        before = payout_snapshot(self, first)
        partial = self.acquisition(start="2026-06-15", end="2026-06-15")
        batch, changed = self.finances([self.transaction("120")], acquisition_id=partial)
        second = publish_payout(self, inputs)
        self.assertNotEqual(second, first)
        self.assertEqual(self.finances_versions(batch), [changed])
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount,finances_version_count "
                "from public.company_payout_reports where id=%s",
                (second,),
            ).fetchone(),
            (160, Decimal("-8.5"), Decimal("151.5"), 2),
        )
        self.assertEqual(
            self.connection.execute(
                "select v.total_amount from private.payout_report_finances_versions p "
                "join private.finances_transaction_versions v on v.id=p.version_id "
                "where p.report_id=%s order by v.posted_date",
                (second,),
            ).fetchall(),
            [(120,), (50,)],
        )
        self.assertEqual(payout_snapshot(self, first), before)
        self.connection.execute("set constraints all immediate")

    def test_report_marketplace_does_not_pin_or_react_to_other_market_revisions(self) -> None:
        inputs = prepare_payout(self)
        self.finances(
            [
                self.transaction("100"),
                self.transaction("40", 4, kind="Adjustment") | {"marketplace_name": "Amazon.ca"},
            ]
        )
        fill_payout_kiosk_month(self, marketplace="Amazon.ca")
        us = publish_payout(self, inputs)
        ca = publish_payout(self, inputs, marketplace_name="Amazon.ca")
        for report, marketplace in ((us, "Amazon.com"), (ca, "Amazon.ca")):
            with self.subTest(marketplace=marketplace):
                self.assertEqual(
                    self.connection.execute(
                        "select count(*),count(*) filter(where d.marketplace_name=%s) "
                        "from private.payout_report_data_kiosk_versions p "
                        "join private.data_kiosk_days d on d.id=p.day_id where p.report_id=%s",
                        (marketplace, report),
                    ).fetchone(),
                    (30, 30),
                )
                self.assertEqual(
                    self.connection.execute(
                        "select count(*),count(*) filter(where v.marketplace_name=%s) "
                        "from private.payout_report_finances_versions p "
                        "join private.finances_transaction_versions v on v.id=p.version_id "
                        "where p.report_id=%s",
                        (marketplace, report),
                    ).fetchone(),
                    (1, 1),
                )
        self.finances(
            [
                self.transaction("50", 4, kind="Adjustment") | {"marketplace_name": "Amazon.ca"},
            ]
        )
        self.assertEqual(publish_payout(self, inputs), us)
        self.assertNotEqual(publish_payout(self, inputs, marketplace_name="Amazon.ca"), ca)
        self.connection.execute("set constraints all immediate")

    def test_empty_finance_coverage_is_frozen_and_canonical_without_version_links(self) -> None:
        self.set_mature_cutoff_date(date(2026, 7, 1))
        company, _ = self.owner()
        self.kiosk(1, [self.component("-10")])
        fill_payout_kiosk_month(self)
        first_half = self.acquisition(start="2026-06-01", end="2026-06-15")
        self.finances([], acquisition_id=first_half)
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "source coverage"),
            self.connection.transaction(),
        ):
            self.report(company)
        second_half = self.acquisition(start="2026-06-16", end="2026-06-30")
        self.finances([], acquisition_id=second_half)
        report = self.report(company)
        coverage = require_row(
            self.connection.execute(
                "select finances_version_count,source_coverage "
                "from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone()
        )
        self.assertEqual(coverage[0], 0)
        self.assertEqual(
            coverage[1],
            [
                {
                    "source": source,
                    "seller_namespace": self.seller,
                    "marketplace_name": "Amazon.com",
                    "start_date": "2026-06-01",
                    "end_date": "2026-06-30",
                }
                for source in ("DATA_KIOSK", "FINANCES")
            ],
        )
        self.finances([])
        self.assertEqual(self.report(company), report)
        self.assertEqual(
            require_row(
                self.connection.execute(
                    "select source_coverage from public.company_payout_reports where id=%s",
                    (report,),
                ).fetchone()
            )[0],
            coverage[1],
        )
        self.connection.execute("set constraints all immediate")

    def test_frozen_coverage_requires_canonical_valid_intervals(self) -> None:
        coverage = [
            {
                "source": "FINANCES",
                "seller_namespace": self.seller,
                "marketplace_name": "Amazon.com",
                "start_date": "2026-06-01",
                "end_date": "2026-06-15",
            }
        ]
        expected = [coverage[0] | {"end_date": "2026-06-30"}]
        self.assertEqual(
            require_row(
                self.connection.execute(
                    "select private.canonical_payout_coverage(%s)",
                    (
                        Jsonb(
                            [
                                coverage[0]
                                | {"start_date": "2026-06-16", "end_date": "2026-06-30"},
                                *coverage,
                                *coverage,
                            ]
                        ),
                    ),
                ).fetchone()
            )[0],
            expected,
        )
        invalid_values: tuple[object, ...] = (
            None,
            dict[str, object](),
            [coverage[0] | {"raw_json": "not permitted"}],
            [coverage[0] | {"end_date": "2026-05-31"}],
        )
        for invalid in invalid_values:
            with (
                self.subTest(invalid=invalid),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "select private.canonical_payout_coverage(%s)", (Jsonb(invalid),)
                )

    def test_frozen_coverage_rejects_missing_intervals_and_empty_day_pins(self) -> None:
        inputs = prepare_payout(self)
        report = publish_payout(self, inputs)
        before = payout_snapshot(self, report)
        # Missing an empty day does not change the amount, but loses its evidence.
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "Incomplete frozen"),
            self.connection.transaction(),
        ):
            self.connection.execute(
                "select private.assert_payout_sources(r,"
                "array(select version_id from private.payout_report_finances_versions "
                "where report_id=r.id),"
                "array(select p.version_id from private.payout_report_data_kiosk_versions p "
                "join private.data_kiosk_days d on d.id=p.day_id "
                "where p.report_id=r.id and d.activity_date<>'2026-06-16'),true) "
                "from public.company_payout_reports r where r.id=%s",
                (report,),
            )
        # Two canonical intervals separated by one day are still incomplete.
        coverage = [
            {
                "source": source,
                "seller_namespace": self.seller,
                "marketplace_name": "Amazon.com",
                "start_date": start,
                "end_date": end,
            }
            for source, start, end in (
                ("DATA_KIOSK", "2026-06-01", "2026-06-30"),
                ("FINANCES", "2026-06-01", "2026-06-14"),
                ("FINANCES", "2026-06-16", "2026-06-30"),
            )
        ]
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "Incomplete frozen"),
            self.connection.transaction(),
        ):
            self.connection.execute(
                "select private.assert_payout_sources("
                "jsonb_populate_record(r,jsonb_build_object('source_coverage',%s::jsonb)),"
                "array(select version_id from private.payout_report_finances_versions "
                "where report_id=r.id),"
                "array(select version_id from private.payout_report_data_kiosk_versions "
                "where report_id=r.id),true) from public.company_payout_reports r where r.id=%s",
                (Jsonb(coverage), report),
            )
        self.assertEqual(payout_snapshot(self, report), before)
        self.connection.execute("set constraints all immediate")
