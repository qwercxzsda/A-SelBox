"""Reuse the latest exact payout inputs, never just an equal monetary result."""

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
        self.finances(
            [self.transaction("100"), self.transaction("200", 4, sku="OTHER")],
            acquisition_id=inputs.acquisition,
        )
        first = generate_payout_reports(self, inputs.company)[0][0]
        self.fee(other, [("2026-01-01", None, "10")])
        second, created = generate_payout_reports(self, inputs.company)[0]
        self.assertTrue(created)
        self.assertNotEqual(first, second)
        self.assertEqual(self.report_totals(first), self.report_totals(second))

    def test_trusted_publication_reuses_snapshot_without_rewriting_audit_reason(self) -> None:
        inputs = prepare_payout(self)
        first = publish_payout(self, inputs)
        before = payout_snapshot(self, first)
        self.assertEqual(
            publish_payout(self, inputs, change_reason="Changed explanation"),
            first,
        )
        self.assertEqual(payout_snapshot(self, first), before)
        self.assert_report_count(1)
        self.connection.execute("set constraints all immediate")

    def test_publication_rejects_fields_outside_its_declared_scope(self) -> None:
        inputs = prepare_payout(self)
        extra_fields: tuple[dict[str, object], ...] = (
            {"unknown": True},
            {"component_count": 0},
            {"captured_seller_namespaces": []},
        )
        for extra in extra_fields:
            with (
                self.subTest(extra=extra),
                self.assertRaisesRegex(psycopg.errors.CheckViolation, "publication scope"),
                self.connection.transaction(),
            ):
                publish_payout(self, inputs, **extra)
        self.assert_report_count(0)
        publish_payout(self, inputs)
        self.assert_report_count(1)
        self.connection.execute("set constraints all immediate")

    def test_new_equal_capture_reuses_the_same_revision_report(self) -> None:
        inputs = prepare_payout(self)
        first = publish_payout(self, inputs)
        self.finances([self.transaction("100")])
        second = publish_payout(self, inputs)
        self.assertEqual(first, second)
        self.assertEqual(self.report_totals(first), self.report_totals(second))
        self.assertEqual(publish_payout(self, inputs), second)
        self.assert_report_count(1)

    def test_new_seller_namespace_with_unassigned_charge_retains_prior_snapshot(self) -> None:
        first_scope = prepare_payout(self)
        first = generate_payout_reports(self, first_scope.company)[0][0]
        before = payout_snapshot(self, first)
        self.seller = "seller-two"
        prepare_payout(self, first_scope.company)
        self.seller = "seller-z-invalid"
        invalid = prepare_payout(self, first_scope.company)
        self.finances(
            [self.transaction("100"), self.transaction("20", 4, sku="UNREGISTERED")],
            acquisition_id=invalid.acquisition,
        )
        self.assertTrue(generate_payout_reports(self, first_scope.company)[0][1])
        self.assert_report_count(2)
        self.assertEqual(payout_snapshot(self, first), before)
        self.connection.execute("set constraints all immediate")
