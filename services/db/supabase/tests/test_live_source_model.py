"""Fresh-baseline lifecycle, exact calculation, retention and tenant checks."""

from datetime import date, timedelta
from decimal import Decimal
from typing import LiteralString, cast
from uuid import UUID

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import publish_report
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class LiveSourceModelTests(SourceModelFixture):
    def test_fee_corrections_refund_date_and_immutable_children(self) -> None:
        company, owner = self.owner()
        first = self.fee(owner, [("2026-01-01", "2026-07-01", "5"), ("2026-07-01", None, "7")])
        settlement, _ = self.settlement(
            [
                self.transaction("100"),
                self.transaction("-100", 4, kind="Refund", activity_date="2026-07-01"),
                self.transaction("12", 5, description="Shipping"),
            ]
        )
        self.assertEqual(
            self.totals([settlement]),
            [(UUID(company), "USD", Decimal("12"), Decimal("2"), Decimal("14"))],
        )
        self.assertEqual(
            self.connection.execute(
                "select fee_rate_percent,fee_period_id,fee_amount "
                "from public.live_company_components where resolution_status='NOT_APPLICABLE'"
            ).fetchone(),
            (None, None, Decimal(0)),
        )
        second = self.fee(owner, [("2026-01-01", None, "6")], first)
        self.assertEqual(self.totals([settlement])[0][-2:], (Decimal("0"), Decimal("12")))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.settlement_preprocess_versions"
            ).fetchone(),
            (1,),
        )
        for statement, values in (
            ("update public.seller_skus set sku='other' where id=%s", (owner,)),
            ("delete from public.seller_skus where id=%s", (owner,)),
        ):
            with self.assertRaises(psycopg.Error), self.connection.transaction():
                self.connection.execute(cast(LiteralString, statement), values)
        with self.assertRaises(psycopg.errors.SerializationFailure), self.connection.transaction():
            self.fee(owner, [], first)
        self.assertEqual(
            str(
                require_row(
                    self.connection.execute(
                        "select current_terms_version_id from public.seller_skus"
                    ).fetchone()
                )[0]
            ),
            second,
        )

    def test_nonoverlap_rates_gaps_zero_and_missing_ownership(self) -> None:
        _, owner = self.owner()
        first = self.fee(owner, [("2026-01-01", None, "0")])
        settlement, _ = self.settlement([self.transaction("0")])
        self.assertEqual(self.totals([settlement])[0][-1], 0)
        for periods in (
            [("2026-01-01", "2026-07-02", "5"), ("2026-07-01", None, "6")],
            [("2026-01-01", None, "5.0000000")],
            [("2026-01-01", None, "NaN")],
            [("2026-01-01", None, "101")],
        ):
            with self.assertRaises(psycopg.Error), self.connection.transaction():
                self.fee(owner, periods, first)
        self.fee(owner, [], first)
        self.assertEqual(
            self.connection.execute(
                "select resolution_status,fee_amount,company_amount from "
                "public.live_company_components"
            ).fetchone(),
            ("MISSING_FEE", None, None),
        )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.totals([settlement])
        unmapped, _ = self.settlement([self.transaction("1", sku="UNMAPPED")], identity="unmapped")
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.totals([unmapped])

    def test_canonical_aliases_and_settlement_source_authority(self) -> None:
        _, owner = self.owner()
        self.fee(owner, [("2026-01-01", None, "5")])
        canonical, old = self.settlement(
            [self.transaction("100"), self.transaction("-9", 4, category="DATA_KIOSK")]
        )
        alias = self.acquisition(document_id="alias")
        same, latest = self.settlement(
            [self.transaction("100"), self.transaction("-9", 4, category="DATA_KIOSK")],
            acquisition_id=alias,
            expected=old,
        )
        self.assertEqual(canonical, same)
        self.assertEqual(self.totals([canonical])[0][-1], Decimal("95"))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.settlement_preprocess_entries "
                "where category='DATA_KIOSK' and version_id in "
                "(select current_version_id from private.settlements)"
            ).fetchone(),
            (1,),
        )
        conflict = self.acquisition(document_id="conflict", digest="c")
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.settlement([self.transaction("91")], acquisition_id=conflict, expected=latest)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.settlement_acquisitions"
            ).fetchone(),
            (3,),
        )

    def test_day_replacement_old_observation_retention_and_comparison(self) -> None:
        company, _ = self.owner()
        day, one = self.kiosk(1, [self.component()])
        report = publish_report(self, company)
        initial_acquisition_count = int(
            require_row(
                self.connection.execute(
                    "select count(*) from private.data_kiosk_acquisitions"
                ).fetchone()
            )[0]
        )
        _, two = self.kiosk(2, [], expected=one)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.live_company_components "
                "where source='DATA_KIOSK' and authoritative"
            ).fetchone(),
            (0,),
        )
        _, three = self.kiosk(3, [self.component("-2")], expected=two)
        _, four = self.kiosk(4, [self.component("-3")], expected=three)
        self.assertEqual(
            self.connection.execute("select private.prune_data_kiosk_preprocess()").fetchone(), (0,)
        )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "delete from private.payout_report_data_kiosk_versions where report_id=%s",
                (report,),
            )
        self.assertEqual(
            self.connection.execute("select private.prune_data_kiosk_preprocess()").fetchone(), (0,)
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_transactions where version_id=%s", (one,)
            ).fetchone(),
            (1,),
        )
        self.assertEqual(
            self.connection.execute(
                "select row_count from private.data_kiosk_preprocess_versions where id=%s", (one,)
            ).fetchone(),
            (1,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_acquisitions"
            ).fetchone(),
            (initial_acquisition_count + 3,),
        )
        old_acquisition = require_row(
            self.connection.execute(
                "select b.acquisition_id from private.data_kiosk_preprocess_versions v "
                "join private.data_kiosk_preprocess_batches b on b.id=v.batch_id where v.id=%s",
                (one,),
            ).fetchone()
        )[0]
        self.kiosk(1, [self.component("-99")], acquisition_id=str(old_acquisition), expected=four)
        self.assertEqual(
            str(
                require_row(
                    self.connection.execute(
                        "select current_version_id from private.data_kiosk_days where id=%s", (day,)
                    ).fetchone()
                )[0]
            ),
            four,
        )
        self.assertEqual(
            require_row(
                self.connection.execute(
                    ("select private.compare_data_kiosk_observations(%s,'v0')->>'available'"),
                    (day,),
                ).fetchone()
            )[0],
            "true",
        )

    def test_strict_combination_rejects_missing_and_mixed_versions(self) -> None:
        self.owner()
        recent = self.recent_activity_date()
        self.kiosk(
            1,
            [self.component(), self.component("100", category="SETTLEMENT")],
            activity_date=recent,
        )
        sql = (
            "select * from private.company_financial_totals(%s,%s,%s,%s,'{}',"
            "array['Amazon.com']::text[])"
        )
        self.assertEqual(
            require_row(
                self.connection.execute(sql, (self.seller, recent, recent, "v0")).fetchone()
            )[-1],
            Decimal("90"),
        )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(sql, (self.seller, recent, recent, "different"))
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                sql,
                (
                    self.seller,
                    recent,
                    date.fromisoformat(recent) + timedelta(days=1),
                    "v0",
                ),
            )

    def test_tenant_visibility_and_no_configuration_writes(self) -> None:
        company, owner = self.owner()
        self.owner("OTHER")
        self.fee(owner, [("2026-01-01", None, "5")])
        self.settlement(
            [
                self.transaction("100"),
                self.transaction("50", 4, sku="OTHER"),
                self.transaction("4", 5, category="DATA_KIOSK"),
            ]
        )
        user_id = self.member(company)
        self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user_id,))
        self.connection.execute("set local role authenticated")
        self.assertEqual(
            self.connection.execute(
                "select sku,company_amount from public.live_company_components"
            ).fetchall(),
            [("SKU", Decimal("95"))],
        )
        self.assertEqual(
            self.connection.execute("select count(*) from public.company_skus").fetchone(), (1,)
        )
        for statement in (
            "select * from private.settlement_acquisitions",
            "select total_amount from private.settlement_preprocess_versions",
            "update public.seller_skus set current_terms_version_id=current_terms_version_id",
            "select private.publish_sku_terms('{}'::jsonb)",
            (
                "select * from "
                "private.company_financial_totals('seller-one','2026-01-01','2026-12-31"
                "','v0','{}','{}')"
            ),
        ):
            with (
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute(statement)
        self.assertEqual(
            self.connection.execute(
                "select amount from public.settlement_preprocess_entries "
                "where category='DATA_KIOSK'"
            ).fetchall(),
            [],
        )
        self.connection.execute("reset role")
        self.connection.execute("set constraints all immediate")

    def test_numeric_bounds_and_incomplete_versions_fail(self) -> None:
        for value in ("1e-1000", "1e999", "0." + "0" * 1000):
            self.connection.execute("select %s::private.exact_numeric", (value,))
        for value in ("1e-1001", "1e1000", "NaN", "Infinity", "-Infinity"):
            with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
                self.connection.execute("select %s::private.exact_numeric", (value,))
        _, owner = self.owner()
        initial = self.fee(owner, [])
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                (
                    "insert into "
                    "public.sku_terms_versions(seller_sku_id,company_id,version_number,"
                    "fee_period_count,change_reason) select s.id,v.company_id,v.version_number+1,"
                    "1,'Incomplete publication' from public.seller_skus s "
                    "join public.sku_terms_versions v on v.id=s.current_terms_version_id "
                    "where s.id=%s"
                ),
                (owner,),
            )
            self.connection.execute("set constraints all immediate")
        self.assertEqual(
            str(
                require_row(
                    self.connection.execute(
                        "select current_terms_version_id from public.seller_skus"
                    ).fetchone()
                )[0]
            ),
            initial,
        )
        partial = self.kiosk_acquisition(1, start="2026-06-15", end="2026-06-16")
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.kiosk(1, [], acquisition_id=partial)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_preprocess_batches"
            ).fetchone(),
            (0,),
        )

    def test_null_scope_and_retention_arguments_are_rejected(self) -> None:
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute("select private.prune_data_kiosk_preprocess(null)")
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "select * from private.company_financial_totals("
                "'seller','2026-06-01','2026-06-30','v0','{}','{}',null)"
            )

    def test_authenticated_filtered_totals_exclude_other_companies(self) -> None:
        company, owner = self.owner()
        self.owner("OTHER")
        self.fee(owner, [("2026-01-01", None, "5")])
        rows = [
            self.transaction(
                "1.23",
                index + 3,
                sku="SKU" if index % 2 else "OTHER",
                activity_date=(date(2026, 6, 1) + timedelta(days=index % 90)).isoformat(),
            )
            for index in range(2000)
        ]
        self.settlement(rows)
        user = self.member(company)
        self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
        self.connection.execute("set local role authenticated")
        mature_cutoff_date = self.recent_activity_date()
        for start, end in (("2026-06-01", "2026-06-30"), ("2026-01-01", "2026-12-31")):
            expected_count = sum(
                row["sku"] == "SKU"
                and start <= str(row["posted_date"]) <= end
                and str(row["posted_date"]) < mature_cutoff_date
                for row in rows
            )
            with self.subTest(start=start, end=end):
                self.assertEqual(
                    self.connection.execute(
                        "select count(*), sum(company_amount) from public.live_company_components "
                        "where activity_date between %s and %s",
                        (start, end),
                    ).fetchone(),
                    (expected_count, Decimal("1.1685") * expected_count),
                )
        self.connection.execute("reset role")
