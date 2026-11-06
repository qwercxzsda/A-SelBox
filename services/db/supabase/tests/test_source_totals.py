"""Native diagnostic totals preserve exact scope, complete buckets and saved inputs."""

from datetime import date
from typing import Any, LiteralString, cast

import psycopg
from psycopg import sql

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    payout_snapshot,
    prepare_payout,
    publish_payout,
    reassign_payout_sku,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class SourceTotalsTests(SourceModelFixture):
    def current(
        self,
        grouping: str = "total",
        limit: int = 50,
        offset: int = 0,
        currency: str | None = "USD",
    ) -> dict[str, Any]:
        return cast(
            dict[str, Any],
            require_row(
                self.connection.execute(
                    "select public.current_source_totals('2026-06-01','2026-06-30','Amazon.com',"
                    "%s,%s,null,%s,%s)",
                    (grouping, currency, limit, offset),
                ).fetchone()
            )[0],
        )

    def report(self, report: str, grouping: str = "total") -> dict[str, Any]:
        return cast(
            dict[str, Any],
            require_row(
                self.connection.execute(
                    "select public.report_source_totals(%s,%s)", (report, grouping)
                ).fetchone()
            )[0],
        )

    def test_current_totals_keep_native_categories_precision_and_whole_day_buckets(self) -> None:
        self.set_mature_cutoff_date(date(2026, 1, 1))
        self.finances(
            [
                self.transaction("100.123456789123456789"),
                self.transaction("20", 4),
                self.transaction("-8", 5, category="DATA_KIOSK"),
                self.transaction("-2", 6, category="SELBOX") | {"sku": None},
                self.transaction("999", 7, kind="Transfer", category="SELBOX") | {"sku": None},
            ]
        )
        self.kiosk(
            1,
            [
                self.component("50", category="FINANCES"),
                self.component("5", category="FINANCES"),
                self.component("-10"),
                self.component("-3", category="SELBOX") | {"sku": None},
                self.component("-0.5") | {"currency": "EUR"},
                self.component("777", category="ANALYSIS_ONLY"),
            ],
        )
        self.seller = "seller-two"
        self.finances([self.transaction("7")])
        self.kiosk(1, [self.component("-1")])
        expected = {
            ("FINANCES", "FINANCES"): ("127.123456789123456789", "3"),
            ("FINANCES", "DATA_KIOSK"): ("-8", "1"),
            ("FINANCES", "SELBOX"): ("-2", "1"),
            ("DATA_KIOSK", "FINANCES"): ("55", "2"),
            ("DATA_KIOSK", "DATA_KIOSK"): ("-11", "2"),
            ("DATA_KIOSK", "SELBOX"): ("-3", "1"),
        }
        for grouping, period in (("total", None), ("month", "2026-06-01")):
            payload = self.current(grouping, limit=1)
            self.assertEqual(
                {
                    (r["source"], r["category"]): (r["amount"], r["row_count"])
                    for r in payload["rows"]
                },
                expected,
            )
            self.assertTrue(
                all(
                    r["seller_namespace"] is None and r["period"] == period for r in payload["rows"]
                )
            )
            self.assertEqual(payload["total_count"], "1")
            self.assertIsNone(payload["next_offset"])
        first, second = self.current("day", 1), self.current("day", 1, 1)
        self.assertEqual((first["total_count"], first["next_offset"]), ("2", 1))
        self.assertEqual({r["seller_namespace"] for r in first["rows"]}, {"seller-one"})
        self.assertEqual(len(first["rows"]), 6)
        self.assertEqual({r["seller_namespace"] for r in second["rows"]}, {"seller-two"})
        self.assertEqual(len(second["rows"]), 2)
        self.assertIsNone(second["next_offset"])
        self.assertEqual(self.current(currency=None)["total_count"], "2")
        self.assertEqual(self.current("day", 1, 2)["rows"], [])
        self.finances([self.transaction("0", activity_date="2026-07-15")])
        months = cast(
            dict[str, Any],
            require_row(
                self.connection.execute(
                    "select public.current_source_totals('2026-06-01','2026-07-31','Amazon.com',"
                    "'month','USD',null,1,0)"
                ).fetchone()
            )[0],
        )
        self.assertEqual(months["total_count"], "2")
        self.assertEqual({row["period"] for row in months["rows"]}, {"2026-06-01", "2026-07-01"})
        self.assertIsNone(months["next_offset"])

    def test_empty_accepted_coverage_and_revisions_are_independent_of_amount_rows(self) -> None:
        acquisition = self.acquisition()
        for _ in range(3):
            self.finances([], acquisition_id=acquisition)
        self.kiosk(1, [])
        administrator = self.administrator()
        self.connection.commit()
        payload = cast(
            dict[str, Any],
            self.as_user(
                administrator,
                "select public.current_source_totals('2026-06-10','2026-06-20','Amazon.com')",
            )[0][0],
        )
        self.assertEqual(payload["rows"], [])
        self.assertEqual(payload["total_count"], "0")
        self.assertEqual(
            payload["scope"],
            {
                "start_date": "2026-06-10",
                "end_date": "2026-06-20",
                "marketplace_name": "Amazon.com",
                "currency": None,
            },
        )
        self.assertCountEqual(
            payload["coverage"],
            [
                {
                    "source": "FINANCES",
                    "seller_namespace": self.seller,
                    "start_date": "2026-06-10",
                    "end_date": "2026-06-20",
                },
                {
                    "source": "DATA_KIOSK",
                    "seller_namespace": self.seller,
                    "start_date": "2026-06-15",
                    "end_date": "2026-06-15",
                },
            ],
        )
        revision = self.as_user(
            administrator,
            "select public.workspace_revisions(array['finances','data_kiosk'])->'revisions'",
        )[0][0]
        self.assertEqual(payload["revision"], revision)
        self.assertIsNone(self.current()["revision"])

    def test_report_totals_keep_saved_account_scope_after_source_and_policy_changes(self) -> None:
        inputs = prepare_payout(self)
        other_company, other_sku = self.owner("OTHER")
        self.fee(other_sku, [("2026-01-01", None, "5")])
        finances = [
            self.transaction("100"),
            self.transaction("50", 4, sku="OTHER"),
            self.transaction("11", 5, kind="Adjustment") | {"marketplace_name": "Amazon.ca"},
        ]
        self.finances(finances)
        components = [
            self.component("-10"),
            self.component("-7", sku="OTHER"),
            self.component("123", category="FINANCES"),
            self.component("-3") | {"currency": "EUR"},
        ]
        _, version = self.kiosk(2, components, expected=inputs.kiosk_version)
        fill_payout_kiosk_month(self, marketplace="Amazon.ca")
        report = publish_payout(self, inputs)
        original = self.report(report)
        self.assertIsNone(original["revision"])
        self.assertEqual(
            original["scope"],
            {
                "report_id": report,
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "marketplace_name": "Amazon.com",
                "currency": "USD",
            },
        )
        self.assertEqual(
            {(r["source"], r["category"]): r["amount"] for r in original["rows"]},
            {
                ("FINANCES", "FINANCES"): "150",
                ("DATA_KIOSK", "FINANCES"): "123",
                ("DATA_KIOSK", "DATA_KIOSK"): "-17",
            },
        )
        other_report = publish_payout(self, inputs, company_id=other_company)
        self.assertEqual(self.report(other_report)["rows"], original["rows"])
        frozen = payout_snapshot(self, report)
        self.connection.commit()
        _, reused = self.kiosk(3, components, expected=version)
        self.assertEqual(reused, version)
        self.kiosk(4, [], expected=reused)
        finances[0] = finances[0] | {"amount": "200", "fee_base": "200"}
        self.finances(finances)
        self.fee(inputs.sku_identity, [("2026-01-01", None, "20")])
        reassign_payout_sku(self, inputs.sku_identity, other_company)
        self.set_mature_cutoff_date(date(2026, 1, 1))
        self.assertEqual(self.report(report), original)
        self.assertEqual(payout_snapshot(self, report), frozen)

    def test_admin_only_access_and_fixed_report_scope(self) -> None:
        inputs = prepare_payout(self)
        report = publish_payout(self, inputs)
        queries: tuple[tuple[LiteralString, tuple[object, ...]], ...] = (
            ("select public.current_source_totals('2026-06-01','2026-06-30','Amazon.com')", ()),
            ("select public.report_source_totals(%s)", (report,)),
        )
        for user in (self.member(inputs.company), self.auth_user()):
            for query, parameters in queries:
                with (
                    self.subTest(user=user, query=query),
                    self.assertRaises(psycopg.errors.InsufficientPrivilege),
                ):
                    self.as_user(user, query, parameters)
        for role in ("anon", "service_role"):
            for query, parameters in queries:
                with (
                    self.subTest(role=role, query=query),
                    self.assertRaises(psycopg.errors.InsufficientPrivilege),
                    self.connection.transaction(),
                ):
                    self.connection.execute(
                        sql.SQL("set local role {}").format(sql.Identifier(role))
                    )
                    self.connection.execute(query, parameters)
        with self.assertRaises(psycopg.errors.InvalidParameterValue), self.connection.transaction():
            self.connection.execute(
                "select private.read_source_totals(%s,'2026-06-01',null,null,"
                "'total',null,null,50,0)",
                (report,),
            )
        with self.assertRaises(psycopg.errors.InvalidParameterValue), self.connection.transaction():
            self.connection.execute("select public.report_source_totals(%s)", (new_id(),))

    def test_shared_finance_versions_are_counted_once_in_saved_scope(self) -> None:
        inputs = prepare_payout(self)
        first_report = publish_payout(self, inputs)
        additional_batch, reused = self.finances([self.transaction("100")])
        self.assertEqual(reused, inputs.finances_version)
        report = new_id()
        self.connection.execute(
            "insert into public.company_payout_reports select (jsonb_populate_record("
            "null::public.company_payout_reports,to_jsonb(r)||jsonb_build_object("
            "'id',%s::uuid,'finances_batch_count',r.finances_batch_count+1))).* "
            "from public.company_payout_reports r where r.id=%s",
            (report, first_report),
        )
        self.connection.execute(
            "insert into private.payout_report_finances_batches(report_id,batch_id) "
            "select %s::uuid,batch_id from private.payout_report_finances_batches "
            "where report_id=%s union all select %s::uuid,%s::uuid",
            (report, first_report, report, additional_batch),
        )
        self.connection.execute(
            "insert into private.payout_report_data_kiosk_observations "
            "select %s::uuid,day_id,batch_id,version_id "
            "from private.payout_report_data_kiosk_observations where report_id=%s",
            (report, first_report),
        )
        self.connection.execute(
            "insert into private.payout_report_terms_versions "
            "select %s::uuid,sku_id,terms_version_id from private.payout_report_terms_versions "
            "where report_id=%s",
            (report, first_report),
        )
        self.connection.execute(
            "insert into public.company_payout_report_components select (jsonb_populate_record("
            "null::public.company_payout_report_components,to_jsonb(c)||jsonb_build_object("
            "'id',private.uuid7(),'report_id',%s::uuid))).* "
            "from public.company_payout_report_components c where c.report_id=%s",
            (report, first_report),
        )
        self.connection.execute("set constraints all immediate")
        self.assertEqual(self.report(report)["rows"], self.report(first_report)["rows"])
        self.assertEqual(self.report(report)["coverage"], self.report(first_report)["coverage"])
