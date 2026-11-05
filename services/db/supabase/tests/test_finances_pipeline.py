"""Finances captures preserve native controls and select complete immutable days."""

from datetime import date, timedelta
from decimal import Decimal
from typing import cast

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.payout_fixtures import (
    fill_payout_kiosk_month,
    generate_payout_reports,
)
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class FinancesPipelineTests(SourceModelFixture):
    def payload(
        self,
        rows: list[dict[str, object]],
        *,
        start: str = "2026-06-01",
        end: str = "2026-06-30",
        acquisition_id: str | None = None,
        summary_amount: str | None = "100",
    ) -> dict[str, object]:
        acquisition = acquisition_id or self.acquisition(start=start, end=end)
        days: list[dict[str, object]] = []
        activity = date.fromisoformat(start)
        while activity <= date.fromisoformat(end):
            current = self.connection.execute(
                "select current_version_id from private.finances_days "
                "where seller_namespace=%s and marketplace_name='Amazon.com' and activity_date=%s",
                (self.seller, activity),
            ).fetchone()
            days.append(
                {
                    "id": new_id(),
                    "marketplace_name": "Amazon.com",
                    "marketplace_id": "ATVPDKIKX0DER",
                    "activity_date": activity.isoformat(),
                    "content_sha256": "a" * 64,
                    "expected_current_version_id": str(current[0]) if current else None,
                    "transactions": [
                        row for row in rows if str(row["posted_at"])[:10] == activity.isoformat()
                    ],
                }
            )
            activity += timedelta(days=1)
        return {
            "id": new_id(),
            "acquisition_id": acquisition,
            "preprocess_version": "v3",
            "days": days,
            "summaries": []
            if summary_amount is None
            else [
                {
                    "marketplace_name": "Amazon.com",
                    "marketplace_id": "ATVPDKIKX0DER",
                    "account_type": "STANDARD_ORDERS",
                    "currency": "USD",
                    "period_start": start,
                    "period_end": end,
                    "net_proceeds": summary_amount,
                    "source_page_number": 1,
                    "source_summary_index": 1,
                }
            ],
        }

    @staticmethod
    def native(
        identity: str,
        amount: str,
        *,
        day: str = "2026-06-15",
        status: str = "DEFERRED",
        original: str | None = None,
        release: str | None = None,
        kind: str = "Shipment",
    ) -> dict[str, object]:
        return {
            "id": new_id(),
            "native_transaction_id": identity,
            "account_type": "STANDARD_ORDERS",
            "transaction_type": kind,
            "transaction_status": status,
            "posted_at": day + "T12:00:00Z",
            "total_amount": amount,
            "currency": "USD",
            "deferred_transaction_id": original,
            "release_transaction_id": release,
            "activity_eligible": original is None and kind != "Transfer",
            "source_page_number": 1,
            "source_record_number": 1,
            "source_fields": {},
            "components": [
                {
                    "id": new_id(),
                    "component_key": identity + "/0",
                    "category": "FINANCES",
                    "component_type": "PRODUCT_SALES",
                    "sku": "SKU",
                    "amount": amount,
                    "currency": "USD",
                    "quantity": "1",
                    "fee_base": amount,
                    "accounting_subtype": None,
                    "source_fields": {"breakdown_path": ["Principal"]},
                }
            ],
        }

    def selected_versions(self) -> list[object]:
        return [
            row[0]
            for row in self.connection.execute(
                "select current_version_id from private.finances_days order by activity_date"
            )
        ]

    def test_original_release_and_transfer_are_not_added_to_activity(self) -> None:
        payload = self.payload(
            [
                self.native("A", "100", status="DEFERRED_RELEASED", release="B"),
                self.native("B", "100", day="2026-06-20", status="RELEASED", original="A"),
                self.native("C", "100", day="2026-06-21", status="RELEASED", kind="Transfer"),
            ]
        )
        self.call("publish_finances_preprocess", payload)
        self.assertEqual(
            self.connection.execute(
                "select sum(total_amount),sum(total_amount) filter(where activity_eligible) "
                "from private.finances_transactions"
            ).fetchone(),
            (Decimal("300"), Decimal("100")),
        )
        self.assertEqual(
            self.connection.execute(
                "select transaction_amount,matched from private.finances_summary_checks"
            ).fetchone(),
            (Decimal("100"), True),
        )
        self.connection.execute("set constraints all immediate")

    def test_status_revision_and_empty_replacement_preserve_old_capture(self) -> None:
        self.call("publish_finances_preprocess", self.payload([self.native("A", "100")]))
        old = self.selected_versions()
        self.call(
            "publish_finances_preprocess",
            self.payload([self.native("A", "100", status="DEFERRED_RELEASED", release="B")]),
        )
        self.assertNotEqual(old, self.selected_versions())
        self.assertEqual(
            self.connection.execute(
                "select sum(t.amount) from private.finances_activity_components t "
                "join private.finances_days d on d.current_version_id=t.version_id"
            ).fetchone(),
            (Decimal("100"),),
        )
        self.call("publish_finances_preprocess", self.payload([], summary_amount="0"))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_transactions t "
                "join private.finances_days d on d.current_version_id=t.version_id"
            ).fetchone(),
            (0,),
        )
        self.assertEqual(
            self.connection.execute(
                "select sum(total_amount) from private.finances_transactions "
                "where version_id=any(%s::uuid[])",
                (old,),
            ).fetchone(),
            (Decimal("100"),),
        )
        self.connection.execute("set constraints all immediate")

    def test_invalid_partition_and_partial_days_leave_selection_unchanged(self) -> None:
        self.call("publish_finances_preprocess", self.payload([self.native("A", "100")]))
        before = self.selected_versions()
        wrong = self.native("A", "100")
        cast(list[dict[str, object]], wrong["components"])[0]["amount"] = "99"
        incomplete = self.payload([])
        incomplete["days"] = []
        for payload in (self.payload([wrong]), incomplete):
            with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
                self.call("publish_finances_preprocess", payload)
        self.assertEqual(before, self.selected_versions())

    def test_summary_check_applies_only_to_its_exact_versions(self) -> None:
        self.call("publish_finances_preprocess", self.payload([self.native("A", "100")]))
        old = self.selected_versions()
        self.assertTrue(
            require_row(
                self.connection.execute(
                    "select cardinality(private.payout_finances_summary_ids("
                    "%s::uuid[],'2026-06-01','2026-06-30'))",
                    (old,),
                ).fetchone()
            )[0]
        )
        self.call(
            "publish_finances_preprocess",
            self.payload([self.native("A", "101")], summary_amount="100"),
        )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "select private.payout_finances_summary_ids(%s::uuid[],'2026-06-01','2026-06-30')",
                (self.selected_versions(),),
            )
        self.assertTrue(
            require_row(
                self.connection.execute(
                    "select cardinality(private.payout_finances_summary_ids("
                    "%s::uuid[],'2026-06-01','2026-06-30'))",
                    (old,),
                ).fetchone()
            )[0]
        )

    def test_latest_three_observations_keep_history_and_prune_payload_explicitly(self) -> None:
        first: list[object] = []
        for observation in range(4):
            self.call(
                "publish_finances_preprocess",
                self.payload([self.native("A", str(observation))], summary_amount=str(observation)),
            )
            if observation == 0:
                first = self.selected_versions()
        self.connection.execute("set constraints all immediate")
        self.assertEqual(
            self.connection.execute("select private.prune_finances_preprocess()").fetchone(), (30,)
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_pruned_versions "
                "where version_id=any(%s::uuid[])",
                (first,),
            ).fetchone(),
            (30,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_transactions "
                "where version_id=any(%s::uuid[])",
                (first,),
            ).fetchone(),
            (0,),
        )

    def test_same_native_id_cannot_move_to_another_day_without_removing_old(self) -> None:
        self.call(
            "publish_finances_preprocess",
            self.payload([self.native("A", "100")], start="2026-06-15", end="2026-06-15"),
        )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.call(
                "publish_finances_preprocess",
                self.payload(
                    [self.native("A", "100", day="2026-06-16")],
                    start="2026-06-16",
                    end="2026-06-16",
                ),
            )
        self.call(
            "publish_finances_preprocess", self.payload([self.native("A", "100", day="2026-06-16")])
        )
        self.assertEqual(
            self.connection.execute(
                "select t.posted_date from private.finances_transactions t "
                "join private.finances_days d on d.current_version_id=t.version_id"
            ).fetchone(),
            (date(2026, 6, 16),),
        )
        self.connection.execute("set constraints all immediate")

    def test_non_amazon_us_keeps_native_channel_and_joins_amazon_summary_control(self) -> None:
        payload = self.payload([self.native("retail", "100")], summary_amount="80")
        payload["preprocess_version"] = "v0"
        archived = require_row(
            self.connection.execute(
                "select to_jsonb(a)-'created_at' from private.finances_acquisitions a where id=%s",
                (payload["acquisition_id"],),
            ).fetchone()
        )[0]
        acquisition = cast(dict[str, object], archived)
        acquisition["id"] = new_id()
        acquisition["marketplace_ids"] = ["ATVPDKIKX0DER", "A2ZV50J4W1RKNI"]
        metadata = cast(dict[str, object], acquisition["api_metadata"])
        cast(list[dict[str, object]], metadata["coverage_marketplaces"]).append(
            {
                "marketplace_id": "A2ZV50J4W1RKNI",
                "marketplace_name": "Non-Amazon US",
                "time_zone": "America/Los_Angeles",
            }
        )
        payload["acquisition_id"] = self.call("publish_finances_acquisition", acquisition)
        days = cast(list[dict[str, object]], payload["days"])
        channel_fee = self.native("channel", "-20", status="RELEASED", kind="Shipment")
        cast(list[dict[str, object]], channel_fee["components"])[0].update(
            component_type="FBA_FULFILLMENT_FEES", fee_base=None, quantity=None
        )
        days.extend(
            [
                day
                | {
                    "id": new_id(),
                    "marketplace_name": "Non-Amazon US",
                    "marketplace_id": "A2ZV50J4W1RKNI",
                    "transactions": [channel_fee] if day["activity_date"] == "2026-06-15" else [],
                }
                for day in list(days)
            ]
        )
        self.call("publish_finances_preprocess", payload)
        self.assertEqual(
            self.connection.execute(
                "select marketplace_name,sum(total_amount) from private.finances_transactions "
                "group by marketplace_name order by marketplace_name"
            ).fetchall(),
            [("Amazon.com", Decimal("100")), ("Non-Amazon US", Decimal("-20"))],
        )
        self.assertEqual(
            self.connection.execute(
                "select marketplace_name,transaction_amount,summary_amount,matched,version_count "
                "from private.finances_summary_checks"
            ).fetchone(),
            ("Amazon.com", Decimal("80"), Decimal("80"), True, 60),
        )
        self.assertEqual(
            require_row(
                self.connection.execute(
                    "select cardinality(private.payout_finances_summary_ids("
                    "%s::uuid[],'2026-06-01','2026-06-30'))",
                    (self.selected_versions(),),
                ).fetchone()
            )[0],
            1,
        )
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        fill_payout_kiosk_month(self)
        reports = generate_payout_reports(self, company)
        self.assertEqual(len(reports), 2)
        self.assertEqual(
            self.connection.execute(
                "select marketplace_name,source_amount,fee_amount,company_amount,"
                "finances_version_count,data_kiosk_version_count "
                "from public.company_payout_reports where company_id=%s order by marketplace_name",
                (company,),
            ).fetchall(),
            [
                ("Amazon.com", Decimal(100), Decimal(-5), Decimal(95), 60, 30),
                ("Non-Amazon US", Decimal(-20), Decimal(0), Decimal(-20), 60, 30),
            ],
        )
        self.assertEqual(
            self.connection.execute(
                "select distinct c.marketplace_name,r.marketplace_name "
                "from public.company_payout_report_components c "
                "join public.company_payout_reports r on r.id=c.report_id "
                "where r.company_id=%s order by c.marketplace_name",
                (company,),
            ).fetchall(),
            [("Amazon.com", "Amazon.com"), ("Non-Amazon US", "Non-Amazon US")],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_days "
                "where marketplace_name='Non-Amazon US'"
            ).fetchone(),
            (0,),
        )
        self.assertEqual(
            self.connection.execute(
                "select company_amount from private.company_financial_totals("
                "%s,'2026-06-01','2026-06-30','v0',"
                "array(select id::uuid from private.finances_days),array['Non-Amazon US'])",
                (self.seller,),
            ).fetchone(),
            (Decimal("75"),),
        )
        self.connection.execute("set constraints all immediate")

    def test_reverse_only_release_link_uses_the_same_immutable_capture(self) -> None:
        original = self.native("A", "100", status="DEFERRED_RELEASED", release="B")
        release = self.native("B", "100", day="2026-06-20", status="RELEASED")
        release["activity_eligible"] = False
        self.call("publish_finances_preprocess", self.payload([original, release]))
        self.assertEqual(
            self.connection.execute(
                "select native_transaction_id,deferred_transaction_id,activity_eligible "
                "from private.finances_transactions order by native_transaction_id"
            ).fetchall(),
            [("A", None, True), ("B", None, False)],
        )
        self.assertEqual(
            self.connection.execute(
                "select transaction_amount,summary_amount,matched "
                "from private.finances_summary_checks"
            ).fetchone(),
            (Decimal("100"), Decimal("100"), True),
        )
        self.connection.execute("set constraints all immediate")

    def test_unmatched_summary_account_without_native_records_blocks_payout(self) -> None:
        payload = self.payload([self.native("A", "100")])
        summaries = cast(list[dict[str, object]], payload["summaries"])
        summaries.append(
            summaries[0]
            | {"account_type": "INVOICED_ORDERS", "net_proceeds": "20", "source_summary_index": 2}
        )
        self.call("publish_finances_preprocess", payload)
        self.assertEqual(
            self.connection.execute(
                "select account_type,matched from private.finances_summary_checks "
                "order by account_type"
            ).fetchall(),
            [("INVOICED_ORDERS", False), ("STANDARD_ORDERS", True)],
        )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "select private.payout_finances_summary_ids(%s::uuid[],'2026-06-01','2026-06-30')",
                (self.selected_versions(),),
            )
        self.connection.execute("set constraints all immediate")

    def test_pruning_reverse_link_original_does_not_change_release_eligibility(self) -> None:
        original = self.native("A", "100", status="DEFERRED_RELEASED", release="B")
        release = self.native("B", "100", day="2026-06-20", status="RELEASED")
        release["activity_eligible"] = False
        first = self.payload([original, release])
        self.call("publish_finances_preprocess", first)
        for _ in range(3):
            self.call(
                "publish_finances_preprocess",
                self.payload([], start="2026-06-15", end="2026-06-15", summary_amount="0"),
            )
        self.connection.execute("set constraints all immediate")
        self.assertEqual(
            self.connection.execute("select private.prune_finances_preprocess()").fetchone(), (1,)
        )
        self.assertEqual(
            self.connection.execute(
                "select native_transaction_id,activity_eligible "
                "from private.finances_transactions order by native_transaction_id"
            ).fetchall(),
            [("B", False)],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_activity_components c "
                "join private.finances_days d on d.current_version_id=c.version_id"
            ).fetchone(),
            (0,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_acquisitions where id=%s",
                (first["acquisition_id"],),
            ).fetchone(),
            (1,),
        )
