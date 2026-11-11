"""Payouts retain their source-local monthly basis independently of the UTC timeline."""

from datetime import date, timedelta
from decimal import Decimal
from typing import cast

import psycopg

from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    generate_payout_reports,
    payout_snapshot,
    prepare_payout,
    report_source_rows,
)
from services.db.supabase.tests.rpc_support import assert_rpc_security
from services.db.supabase.tests.source_fixtures import SourceModelFixture, kiosk_timestamp, new_id
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
                "from public.live_company_components where authoritative "
                "and activity_date between '2026-06-01' and '2026-06-30' "
                "and company_id=%s::uuid and marketplace_name=%s and currency=%s",
                (company, marketplace, currency),
            )
        }
        frozen = {
            (source, row_id): amounts
            for source, row_id, *amounts in self.as_user(
                user,
                "select source,source_row_id::text,source_amount,fee_amount,company_amount "
                "from private.read_payout_report_records(%s) where authoritative",
                (report,),
            )
        }
        self.assertEqual(live, {key: tuple(value) for key, value in frozen.items()})

    def test_all_namespaces_currencies_types_and_rows_match_for_company_and_administrator(
        self,
    ) -> None:
        inputs = prepare_payout(self)
        self.seller = "seller-two"
        prepare_payout(self, inputs.company)
        self.seller = "seller-three"
        self.finances([])
        self.kiosk(
            1,
            [self.component("0.123456789123456789") | {"currency": "EUR"}],
        )
        fill_payout_kiosk_month(self)
        reports = generate_payout_reports(self, inputs.company)
        self.assertEqual(len(reports), 2)
        headers = self.connection.execute(
            "select id::text,currency,source_amount,fee_amount,company_amount "
            "from public.latest_company_payout_reports order by currency"
        ).fetchall()
        self.assertEqual(
            [row[1:] for row in headers],
            [
                (
                    "EUR",
                    Decimal("0.123456789123456789"),
                    Decimal(0),
                    Decimal("0.123456789123456789"),
                ),
                ("USD", Decimal(180), Decimal(-10), Decimal(170)),
            ],
        )
        member, administrator = self.member(inputs.company), self.administrator()
        for report, currency, *_ in headers:
            for user in (member, administrator):
                self.assert_same_basis(inputs.company, user, report, currency)
        self.assertEqual(
            len(
                {
                    row["seller_namespace"]
                    for row in report_source_rows(
                        self, administrator, headers[1][0], grouping="day"
                    )
                }
            ),
            2,
        )
        other, _ = self.owner("OTHER")
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.read_payout_totals(self.member(other), headers[0][0])
        self.connection.execute("set constraints all immediate")

    def publish_market_month(self, marketplace: str, *, version: str = "v0") -> None:
        capture = self.acquisition(
            marketplace=marketplace,
            marketplace_id="A1VC38T7YXB528" if marketplace == "Amazon.co.jp" else "ATVPDKIKX0DER",
            time_zone="Asia/Tokyo" if marketplace == "Amazon.co.jp" else "America/Los_Angeles",
            amazon_scope="JAPAN" if marketplace == "Amazon.co.jp" else "NA",
        )
        self.finances([], acquisition_id=capture, version=version)
        acquisition = self.kiosk_acquisition(1, start="2026-06-01", end="2026-06-30")
        self.call(
            "publish_data_kiosk_preprocess",
            {
                "id": new_id(),
                "acquisition_id": acquisition,
                "preprocess_version": version,
                "dataset_key": "economics",
                "days": [
                    {
                        "id": new_id(),
                        "marketplace_name": marketplace,
                        "activity_date": (date(2026, 6, 1) + timedelta(days=day)).isoformat(),
                        "activity_at": kiosk_timestamp(
                            (date(2026, 6, 1) + timedelta(days=day)).isoformat(), marketplace
                        ),
                        "expected_current_version_id": None,
                        "content_sha256": "c" * 64,
                        "transactions": [self.component("-1")] if day == 14 else [],
                    }
                    for day in range(30)
                ],
            },
        )

    def test_coverage_uses_actual_namespace_marketplace_pairs_and_versions(self) -> None:
        company, _ = self.owner()
        self.publish_market_month("Amazon.com")
        self.seller = "seller-japan"
        self.publish_market_month("Amazon.co.jp", version="v2")
        reports = generate_payout_reports(self, company)
        self.assertEqual(len(reports), 2)
        member = self.member(company)
        for (report, _), marketplace in zip(reports, ("Amazon.co.jp", "Amazon.com"), strict=True):
            self.assertEqual(
                self.connection.execute(
                    "select source_amount,data_kiosk_version_count,marketplace_name "
                    "from public.company_payout_reports where id=%s",
                    (report,),
                ).fetchone(),
                (Decimal(-1), 30, marketplace),
            )
            self.assert_same_basis(company, member, report, "USD")
        self.connection.execute("set constraints all immediate")

    def test_incomplete_namespace_cannot_hide_behind_another_complete_namespace(self) -> None:
        inputs = prepare_payout(self)
        self.seller = "incomplete-seller"
        self.kiosk(1, [self.component("-20")])
        with self.assertRaisesRegex(psycopg.errors.CheckViolation, "source coverage"):
            generate_payout_reports(self, inputs.company)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )

    def test_zero_kiosk_amount_keeps_original_fee_rules_in_current_source_and_payout(self) -> None:
        inputs = prepare_payout(self)
        self.kiosk(
            2,
            [
                self.component("-10"),
                self.component("0") | {"fee_base": "100", "quantity": "3"},
            ],
            expected=inputs.kiosk_version,
        )
        report = generate_payout_reports(self, inputs.company)[0][0]
        self.assert_same_basis(inputs.company, self.member(inputs.company), report, "USD")
        self.assertEqual(
            self.connection.execute(
                "select authoritative,fee_amount,company_amount from "
                "private.read_payout_report_records(%s) "
                "where (source_amount=0 or source_amount is null)",
                (report,),
            ).fetchall(),
            [(True, Decimal(-5), Decimal(-5))],
        )
        self.connection.execute("set constraints all immediate")

    def test_entire_absent_namespace_month_blocks_then_recovers_with_empty_coverage(self) -> None:
        inputs = prepare_payout(self)
        self.seller = "historical-seller"
        self.kiosk(1, [self.component("-20")], activity_date="2026-05-15")
        with self.assertRaisesRegex(psycopg.errors.CheckViolation, "source coverage"):
            generate_payout_reports(self, inputs.company)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.company_payout_reports"
            ).fetchone(),
            (0,),
        )
        fill_payout_kiosk_month(self)
        self.finances([])
        report = generate_payout_reports(self, inputs.company)[0][0]
        self.assert_same_basis(inputs.company, self.member(inputs.company), report, "USD")
        self.assertEqual(
            self.connection.execute(
                "select data_kiosk_version_count from public.company_payout_reports where id=%s",
                (report,),
            ).fetchone(),
            (60,),
        )
        self.connection.execute("set constraints all immediate")

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

    def test_payout_type_totals_page_exactly_and_reject_invalid_or_anonymous_requests(self) -> None:
        inputs = prepare_payout(self)
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

    def test_currency_drilldown_filters_before_pagination_and_count(self) -> None:
        inputs = prepare_payout(self)
        self.kiosk(
            2,
            [self.component("-10"), self.component("-20") | {"currency": "EUR"}],
            expected=inputs.kiosk_version,
        )
        member = self.member(inputs.company)
        for currency, expected in (("EUR", "1"), ("USD", "2"), ("JPY", "0")):
            page = self.as_user(
                member, "select public.transaction_page(p_currency=>%s,p_limit=>1)", (currency,)
            )[0][0]
            self.assertEqual(cast(dict[str, object], page)["total_count"], expected)
            self.assertTrue(
                all(
                    row["currency"] == currency
                    for row in cast(list[dict[str, object]], cast(dict[str, object], page)["rows"])
                )
            )
            self.assertEqual(
                self.as_user(
                    member, "select public.transaction_count(p_currency=>%s)", (currency,)
                ),
                [(expected,)],
            )
        for currency in ("usd", "", "USD' or true--"):
            for query in (
                "select public.transaction_count(p_currency=>%s)",
                "select public.transaction_page(p_currency=>%s)",
            ):
                with self.assertRaises(psycopg.errors.InvalidParameterValue):
                    self.as_user(member, query, (currency,))

    def test_zero_only_month_is_visible_in_current_source_and_latest_report(self) -> None:
        company, _ = self.owner()
        empty = generate_payout_reports(self, company)[0][0]
        self.kiosk(1, [self.component("0")])
        self.finances([])
        fill_payout_kiosk_month(self)
        report = generate_payout_reports(self, company)[0][0]
        self.assertNotEqual(empty, report)
        member = self.member(company)
        self.assert_same_basis(company, member, report, "USD")
        self.assertEqual(
            self.as_user(
                member,
                "select id::text,currency,component_count,company_amount "
                "from public.latest_company_payout_reports",
            ),
            [(report, "USD", 1, Decimal(0))],
        )
        self.assertEqual(
            self.as_user(member, "select count(*) from public.company_payout_reports"), [(2,)]
        )
        self.connection.execute("set constraints all immediate")
