"""Reuse the latest exact payout inputs, never just an equal monetary result."""

from decimal import Decimal

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import (
    generate_payout_reports,
    payout_snapshot,
    prepare_payout,
    publish_payout,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class PayoutIdempotencyTests(SourceModelFixture):
    def assert_report_count(self, expected: int) -> None:
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (expected,),
        )

    def report_totals(self, report: str) -> tuple[object, ...]:
        return require_row(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount from public.company_payout_reports "
                "where id=%s",
                (report,),
            ).fetchone()
        )

    def test_unchanged_generation_preserves_every_saved_row_and_timestamp(self) -> None:
        inputs = prepare_payout(self)
        first = generate_payout_reports(self, inputs.company)
        self.assertEqual(len(first), 1)
        report, created = first[0]
        self.assertTrue(created)
        self.connection.commit()
        before = payout_snapshot(self, report)
        self.assertEqual(generate_payout_reports(self, inputs.company), [(report, False)])
        self.assertEqual(payout_snapshot(self, report), before)
        self.assert_report_count(1)
        self.connection.execute("set constraints all immediate")

    def test_source_versions_including_empty_days_create_new_reports_at_equal_totals(self) -> None:
        inputs = prepare_payout(self)
        first = generate_payout_reports(self, inputs.company)[0][0]
        before = payout_snapshot(self, first)
        self.settlement(
            [self.transaction("100")],
            acquisition_id=inputs.acquisition,
            expected=inputs.settlement_version,
        )
        second, created = generate_payout_reports(self, inputs.company)[0]
        self.assertTrue(created)
        self.assertNotEqual(first, second)
        self.assertEqual(self.report_totals(first), self.report_totals(second))
        empty = self.connection.execute(
            "select current_version_id::text from private.data_kiosk_days "
            "where seller_namespace=%s and activity_date='2026-06-16'",
            (self.seller,),
        ).fetchone()
        if empty is None:
            self.fail("Expected complete empty-day coverage.")
        _, replacement = self.kiosk(
            2, [], expected=empty[0], digest="c", activity_date="2026-06-16"
        )
        third, created = generate_payout_reports(self, inputs.company)[0]
        self.assertTrue(created)
        self.assertNotIn(third, (first, second))
        self.assertEqual(self.report_totals(first), self.report_totals(third))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.payout_report_data_kiosk_versions "
                "where report_id=%s and version_id=%s",
                (third, replacement),
            ).fetchone(),
            (1,),
        )
        self.assertEqual(payout_snapshot(self, first), before)
        self.assert_report_count(3)
        self.connection.execute("set constraints all immediate")

    def test_control_only_source_revision_changes_reconciliation_not_company_totals(self) -> None:
        inputs = prepare_payout(self)
        first = generate_payout_reports(self, inputs.company)[0][0]
        self.settlement(
            [
                self.transaction("100"),
                self.transaction("-12", 4, kind="ServiceFee", category="DATA_KIOSK")
                | {"sku": None},
            ],
            acquisition_id=inputs.acquisition,
            expected=inputs.settlement_version,
        )
        second, created = generate_payout_reports(self, inputs.company)[0]
        self.assertTrue(created)
        self.assertNotEqual(first, second)
        self.assertEqual(self.report_totals(first), self.report_totals(second))
        self.assertEqual(
            self.connection.execute(
                "select data_kiosk_settlement_control from private.payout_report_reconciliation "
                "where report_id=%s",
                (second,),
            ).fetchone(),
            (Decimal(-12),),
        )
        self.connection.execute("set constraints all immediate")

    def test_used_terms_revision_matters_even_when_rate_and_totals_are_identical(self) -> None:
        inputs = prepare_payout(self)
        first = generate_payout_reports(self, inputs.company)[0][0]
        before = payout_snapshot(self, first)
        self.fee(inputs.sku_identity, [("2026-01-01", None, "5")])
        second, created = generate_payout_reports(self, inputs.company)[0]
        self.assertTrue(created)
        self.assertNotEqual(first, second)
        self.assertEqual(self.report_totals(first), self.report_totals(second))
        self.assertEqual(payout_snapshot(self, first), before)

    def test_unused_sku_terms_do_not_change_a_snapshot(self) -> None:
        inputs = prepare_payout(self)
        first = generate_payout_reports(self, inputs.company)[0][0]
        before = payout_snapshot(self, first)
        _, unused = self.owner("UNUSED")
        self.fee(unused, [("2026-01-01", None, "23")])
        self.assertEqual(generate_payout_reports(self, inputs.company), [(first, False)])
        self.assertEqual(payout_snapshot(self, first), before)
        self.assert_report_count(1)

    def test_other_company_terms_used_for_exclusion_are_part_of_the_snapshot(self) -> None:
        inputs = prepare_payout(self)
        _, other = self.owner("OTHER")
        self.settlement(
            [self.transaction("100"), self.transaction("200", 4, sku="OTHER")],
            acquisition_id=inputs.acquisition,
            expected=inputs.settlement_version,
        )
        first = generate_payout_reports(self, inputs.company)[0][0]
        self.fee(other, [("2026-01-01", None, "10")])
        second, created = generate_payout_reports(self, inputs.company)[0]
        self.assertTrue(created)
        self.assertNotEqual(first, second)
        self.assertEqual(self.report_totals(first), self.report_totals(second))

    def test_trusted_publication_reuses_complete_snapshot_and_ignores_labels(self) -> None:
        inputs = prepare_payout(self)
        first = publish_payout(self, inputs)
        before = payout_snapshot(self, first)
        self.assertEqual(
            publish_payout(
                self, inputs, report_name="Another label", change_reason="Changed explanation"
            ),
            first,
        )
        self.assertEqual(payout_snapshot(self, first), before)
        self.assert_report_count(1)
        self.connection.execute("set constraints all immediate")

    def test_new_empty_source_pin_distinguishes_equal_total_reports(self) -> None:
        inputs = prepare_payout(self)
        first = publish_payout(self, inputs)
        self.settlement([], identity="empty-settlement")
        second = publish_payout(self, inputs)
        self.assertNotEqual(first, second)
        self.assertEqual(self.report_totals(first), self.report_totals(second))
        self.assertEqual(publish_payout(self, inputs), second)
        self.assert_report_count(2)

    def test_new_namespace_and_source_change_replace_one_aggregate_atomically(self) -> None:
        first_scope = prepare_payout(self)
        first = generate_payout_reports(self, first_scope.company)[0][0]
        self.seller = "seller-two"
        second_scope = prepare_payout(self, first_scope.company)
        previous = generate_payout_reports(self, first_scope.company)[0][0]
        before = payout_snapshot(self, previous)
        self.kiosk(2, [self.component("-20")], expected=second_scope.kiosk_version)
        reports = generate_payout_reports(self, first_scope.company)
        self.assertEqual(len(reports), 1)
        self.assertTrue(reports[0][1])
        self.assertNotIn(reports[0][0], (first, previous))
        self.assertEqual(payout_snapshot(self, previous), before)
        self.assert_report_count(3)
        self.connection.execute("set constraints all immediate")

    def test_later_invalid_scope_rolls_back_new_scope_without_touching_reused_report(self) -> None:
        first_scope = prepare_payout(self)
        first = generate_payout_reports(self, first_scope.company)[0][0]
        before = payout_snapshot(self, first)
        self.seller = "seller-two"
        prepare_payout(self, first_scope.company)
        self.seller = "seller-z-invalid"
        invalid = prepare_payout(self, first_scope.company)
        self.settlement(
            [self.transaction("100"), self.transaction("20", 4, sku="UNREGISTERED")],
            acquisition_id=invalid.acquisition,
            expected=invalid.settlement_version,
        )
        with self.assertRaises(psycopg.errors.CheckViolation):
            generate_payout_reports(self, first_scope.company)
        self.assert_report_count(1)
        self.assertEqual(payout_snapshot(self, first), before)
        self.connection.execute("set constraints all immediate")
