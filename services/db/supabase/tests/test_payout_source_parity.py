"""Payouts retain their source-local monthly basis independently of the UTC timeline."""

from datetime import date
from typing import cast

import psycopg

from services.db.supabase.tests.payout_fixtures import (
    generate_payout_reports,
    payout_snapshot,
    prepare_payout,
)
from services.db.supabase.tests.rpc_support import assert_rpc_security
from services.db.supabase.tests.source_fixtures import SourceModelFixture
from services.db.supabase.tests.verification.payout_source_parity import source_period_totals


class PayoutSourceParityTests(SourceModelFixture):
    def read_payout_totals(
        self, user: str, report: str, *, grouped: bool = True
    ) -> dict[str, object]:
        return cast(
            dict[str, object],
            self.as_user(user, "select public.payout_report_totals(%s,%s)", (report, grouped))[0][
                0
            ],
        )

    def assert_same_basis(self, company: str, user: str, report: str, currency: str) -> None:
        scope = self.connection.execute(
            "select marketplace_name from public.company_payout_reports where id=%s", (report,)
        ).fetchone()
        self.assertIsNotNone(scope)
        marketplace = cast(tuple[str], scope)[0]
        self.assertIsNotNone(marketplace)
        for grouped in (False, True):
            current = source_period_totals(
                self.connection,
                user,
                date(2026, 6, 1),
                date(2026, 6, 30),
                company,
                currency,
                marketplace,
                grouped,
            )
            self.assertEqual(self.read_payout_totals(user, report, grouped=grouped), current)
        live = {
            (source, str(source_id)): (amount, fee, company_amount)
            for source, source_id, amount, fee, company_amount in self.as_user(
                user,
                "select source,source_row_id,source_amount,fee_amount,company_amount "
                "from public.live_company_components where "
                "activity_date between '2026-06-01' and '2026-06-30' "
                "and company_id=%s::uuid and marketplace_name=%s and currency=%s",
                (company, marketplace, currency),
            )
        }
        frozen = {
            (source, row_id): amounts
            for source, row_id, *amounts in self.as_user(
                user,
                "select source,source_row_id::text,source_amount,fee_amount,company_amount "
                "from private.read_payout_report_records(%s)",
                (report,),
            )
        }
        self.assertEqual(live, {key: tuple(value) for key, value in frozen.items()})

    def test_source_changes_replace_latest_only_after_generation_and_history_is_frozen(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        first = generate_payout_reports(self, inputs.company)[0][0]
        before = payout_snapshot(self, first)
        self.fee(inputs.sku_identity, [("2026-01-01", None, "7")])
        self.assertEqual(
            self.connection.execute(
                "select id::text from public.latest_company_payout_reports"
            ).fetchall(),
            [(first,)],
        )
        latest = generate_payout_reports(self, inputs.company)[0][0]
        self.assertNotEqual(first, latest)
        self.assertEqual(payout_snapshot(self, first), before)
        self.assert_same_basis(inputs.company, self.member(inputs.company), latest, "USD")
        self.assertEqual(
            self.connection.execute(
                "select id::text from public.latest_company_payout_reports"
            ).fetchall(),
            [(latest,)],
        )

    def test_dense_payout_pages_keep_exact_counts_across_sparse_final_day_and_type(self) -> None:
        inputs = prepare_payout(self)
        self.finances(
            [
                self.transaction(
                    "1",
                    index + 3,
                    activity_date="2026-06-30" if index == 60 else "2026-06-15",
                    kind="Refund" if index == 60 else "Shipment",
                )
                for index in range(61)
            ]
        )
        report = generate_payout_reports(self, inputs.company)[0][0]
        actor = self.member(inputs.company)
        for offset, types, expected_day, count in (
            (0, None, "2026-06-30", 61),
            (1, None, "2026-06-15", 61),
            (61, None, None, 61),
            (0, ["PRODUCT_REFUNDS"], "2026-06-30", 1),
            (1, ["PRODUCT_REFUNDS"], None, 1),
        ):
            with self.subTest(offset=offset, types=types):
                response = self.as_user(
                    actor,
                    "select public.payout_report_records(%s,1,%s,%s)",
                    (report, offset, types),
                )[0][0]
                page = cast(dict[str, object], response)
                self.assertEqual(page["total_count"], str(count))
                self.assertEqual(
                    [row["activity_date"] for row in cast(list[dict[str, object]], page["rows"])],
                    [] if expected_day is None else [expected_day],
                )

    def test_payout_type_totals_page_exactly_and_reject_invalid_or_anonymous_requests(self) -> None:
        inputs = prepare_payout(self)
        self.finances([self.transaction("100"), self.transaction("-20", 4, kind="Refund")])
        report = generate_payout_reports(self, inputs.company)[0][0]
        member = self.member(inputs.company)
        first = self.as_user(member, "select public.payout_report_totals(%s,true,1,0)", (report,))[
            0
        ][0]
        second = self.as_user(member, "select public.payout_report_totals(%s,true,1,1)", (report,))[
            0
        ][0]
        self.assertEqual(cast(dict[str, object], first)["next_offset"], 1)
        self.assertIsNone(cast(dict[str, object], second)["next_offset"])
        self.assertEqual(
            cast(list[object], cast(dict[str, object], first)["rows"])
            + cast(list[object], cast(dict[str, object], second)["rows"]),
            self.read_payout_totals(member, report)["rows"],
        )
        assert_rpc_security(self, "public.payout_report_totals(uuid,boolean,integer,bigint)")
        for identifier, grouped, limit, offset in (
            (None, True, 1, 0),
            (report, None, 1, 0),
            (report, True, 0, 0),
            (report, True, 1, -1),
        ):
            with self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.as_user(
                    member,
                    "select public.payout_report_totals(%s,%s,%s,%s)",
                    (identifier, grouped, limit, offset),
                )
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.payout_report_totals(%s)", (report,))
