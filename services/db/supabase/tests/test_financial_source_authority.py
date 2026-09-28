"""Category authority and daily SelBox reconciliation never double-count sources."""

from datetime import date, timedelta
from decimal import Decimal
from typing import cast

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.transaction_fixtures import TransactionPageFixture


class FinancialSourceAuthorityTests(TransactionPageFixture):
    def test_mature_cutoff_date_uses_two_calendar_months_in_every_session_timezone(self) -> None:
        expected = require_row(
            self.connection.execute(
                "select ((current_timestamp at time zone 'UTC')::date - interval '2 months')::date"
            ).fetchone()
        )[0]
        for timezone in ("Pacific/Kiritimati", "Pacific/Honolulu", "UTC"):
            self.connection.execute("select set_config('TimeZone',%s,true)", (timezone,))
            self.assertEqual(self.mature_cutoff_date(), expected)

    def test_category_boundaries_and_selbox_residual_preserve_company_entitlement(self) -> None:
        mature_cutoff_date = self.mature_cutoff_date()
        before = mature_cutoff_date - timedelta(days=1)
        company, sku = self.owner()
        terms = self.fee(sku, [(date(before.year, 1, 1).isoformat(), None, "10")])
        settlement, version = self.settlement(
            [
                self.transaction("100", 3, activity_date=before.isoformat()),
                self.transaction("-5", 4, activity_date=before.isoformat(), category="SELBOX")
                | {"family": None},
                self.transaction("-8", 5, activity_date=before.isoformat(), category="DATA_KIOSK"),
                self.transaction("1000", 6, activity_date=mature_cutoff_date.isoformat()),
                self.transaction(
                    "-999", 7, activity_date=mature_cutoff_date.isoformat(), category="SELBOX"
                )
                | {"family": None},
                self.transaction(
                    "-100", 8, activity_date=mature_cutoff_date.isoformat(), category="DATA_KIOSK"
                )
                | {"sku": None},
            ]
        )
        kiosk_versions: list[str] = []
        for number, day, sales, retained, costs in (
            (1, before, "900", "-99", "-10"),
            (2, mature_cutoff_date, "200", "-7", "-20"),
        ):
            _, kiosk_version = self.kiosk(
                number,
                [
                    self.component(sales, category="SETTLEMENT")
                    | {"component_type": "NET_PRODUCT_SALES", "fee_base": sales},
                    self.component(retained, category="SELBOX") | {"sku": None},
                    self.component(costs),
                    self.component("999", category="ANALYSIS_ONLY"),
                ],
                activity_date=day.isoformat(),
            )
            kiosk_versions.append(kiosk_version)
        operator, member = self.operator(), self.member(company)
        for user, count, reported in ((operator, "7", "260"), (member, "4", "270")):
            page = self.assert_matches_view(user, p_direction="asc")
            self.assertEqual(page["total_count"], count)
            totals = self.as_user(
                user, "select public.transaction_totals(p_date_from => %s)", (before,)
            )[0][0]
            total = cast(dict[str, list[dict[str, str]]], totals)["rows"][0]
            self.assertEqual(Decimal(total["reported_amount"]), Decimal(reported))
            self.assertEqual(Decimal(total["service_fee"]), Decimal(-30))
            self.assertEqual(Decimal(total["company_amount"]), Decimal(240))
            self.assertEqual(total["row_count"], count)
        self.assertEqual(
            self.page(operator, p_company_ids=[company])["rows"], self.page(member)["rows"]
        )
        retained_rows = [
            row
            for row in cast(list[dict[str, object]], self.page(operator)["rows"])
            if row["category"] == "SELBOX"
        ]
        self.assertEqual(len(retained_rows), 3)
        for row in retained_rows:
            self.assertIsNone(row["company_id"])
            self.assertIsNone(row["terms_version_id"])
            self.assertEqual(row["company_amount"], "0")
            self.assertEqual(row["fee_amount"], "0")
            self.assertEqual(row["resolution_status"], "NOT_APPLICABLE")
        self.assertEqual(
            self.as_user(member, "select * from private.live_source_reconciliation"), []
        )
        details = self.connection.execute(
            "select source_amount,authoritative,fee_amount,company_amount "
            "from private.resolve_company_components(%s::uuid[],%s::uuid[],%s::uuid[]) "
            "where source='DATA_KIOSK' and activity_date=%s and category='SETTLEMENT'",
            ([version], kiosk_versions, [terms], before),
        ).fetchall()
        self.assertEqual(details, [(Decimal(900), False, None, None)])
        strict = self.connection.execute(
            "select source_amount,fee_amount,company_amount from private.company_financial_totals("
            "%s,%s,%s,'v0',%s::uuid[],array['Amazon.com'])",
            (self.seller, before, mature_cutoff_date, [settlement]),
        ).fetchall()
        self.assertEqual(strict, [(Decimal(270), Decimal(-30), Decimal(240))])

    def test_strict_reads_require_mature_kiosk_coverage_and_accept_unallocated_cost_controls(
        self,
    ) -> None:
        mature_cutoff_date = self.mature_cutoff_date()
        before = mature_cutoff_date - timedelta(days=1)
        self.owner()
        settlement, _ = self.settlement(
            [
                self.transaction("-8", activity_date=before.isoformat(), category="DATA_KIOSK")
                | {"sku": None, "family": "C3_STORAGE"}
            ]
        )
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "Data Kiosk day coverage"),
            self.connection.transaction(),
        ):
            self.connection.execute(
                "select private.assert_company_source_scope("
                "%s,%s,%s,'v0',%s::uuid[],array['Amazon.com'])",
                (self.seller, before, before, [settlement]),
            )
        self.kiosk(1, [self.component("-10")], activity_date=before.isoformat())
        self.assertEqual(
            self.connection.execute(
                "select source_amount from private.company_financial_totals("
                "%s,%s,%s,'v0',%s::uuid[],array['Amazon.com'])",
                (self.seller, before, before, [settlement]),
            ).fetchall(),
            [(Decimal(-10),)],
        )
        self.kiosk(2, [self.component("30")], activity_date=mature_cutoff_date.isoformat())
        self.assertEqual(
            self.connection.execute(
                "select source_amount from private.company_financial_totals("
                "%s,%s,%s,'v0',array['00000000-0000-0000-0000-000000000001']::uuid[],"
                "array['Amazon.com'])",
                (self.seller, mature_cutoff_date, mature_cutoff_date),
            ).fetchall(),
            [(Decimal(30),)],
        )

    def test_difference_uses_data_kiosk_category_and_preserves_unmatched_dimensions(self) -> None:
        day = self.mature_cutoff_date() - timedelta(days=1)
        earlier = day - timedelta(days=1)
        self.owner()
        _, settlement_version = self.settlement(
            [
                self.transaction("100", 3, activity_date=day.isoformat()),
                self.transaction("-5", 4, activity_date=day.isoformat(), category="SELBOX")
                | {"family": None},
                self.transaction("-8", 5, activity_date=day.isoformat(), category="DATA_KIOSK"),
                self.transaction("-3", 6, activity_date=day.isoformat(), category="DATA_KIOSK")
                | {"sku": None, "marketplace_name": None, "transaction_type": "FBAFees"},
                self.transaction("-4", 7, activity_date=day.isoformat(), category="DATA_KIOSK")
                | {"marketplace_name": "Amazon.ca"},
            ]
        )
        _, kiosk_version = self.kiosk(
            1,
            [
                self.component("900", category="SETTLEMENT"),
                self.component("-99", category="SELBOX") | {"sku": None},
                self.component("-10"),
                self.component("-1") | {"currency": "EUR"},
            ],
            activity_date=day.isoformat(),
        )
        _, earlier_version = self.kiosk(
            2, [self.component("-11")], activity_date=earlier.isoformat()
        )
        rows = self.connection.execute(
            "select activity_date,marketplace_name,currency,data_kiosk_settlement_control,"
            "data_kiosk_category_amount,"
            "difference,settlement_total,accounted_total "
            "from private.resolve_source_reconciliation(%s::uuid[],%s::uuid[]) "
            "order by activity_date,marketplace_name nulls first,currency",
            ([settlement_version], [kiosk_version, earlier_version]),
        ).fetchall()
        expected = [
            (earlier, "Amazon.com", "USD", 0, -11, 11, 0, 0),
            (day, None, "USD", -3, 0, -3, -3, -3),
            (day, "Amazon.ca", "USD", -4, 0, -4, -4, -4),
            (day, "Amazon.com", "EUR", 0, -1, 1, 0, 0),
            (day, "Amazon.com", "USD", -8, -10, 2, 87, 87),
        ]
        self.assertEqual(rows, expected)
        operator = self.operator()
        selection = {
            "p_sources": ["RECONCILIATION"],
            "p_date_from": day.isoformat(),
            "p_marketplaces": ["Amazon.com"],
            "p_types": ["SETTLEMENT_KIOSK_DIFFERENCE"],
        }
        original = self.assert_matches_view(operator, **selection)
        self.assertEqual(original["total_count"], "2")
        self.assertEqual(self.page(operator, p_fee_applicable=True, **selection)["rows"], [])
        ids = {
            row["currency"]: row["source_row_id"]
            for row in cast(list[dict[str, object]], original["rows"])
        }
        self.kiosk(
            3,
            [self.component("-12"), self.component("-1") | {"currency": "EUR"}],
            expected=kiosk_version,
            activity_date=day.isoformat(),
        )
        revised = self.assert_matches_view(operator, p_order_by="amount", **selection)
        self.assertEqual(
            {
                row["currency"]: row["source_row_id"]
                for row in cast(list[dict[str, object]], revised["rows"])
            },
            ids,
        )

    def test_mature_kiosk_authority_excludes_settlement_but_includes_costs(self) -> None:
        before = self.mature_cutoff_date() - timedelta(days=1)
        company, _ = self.owner()
        self.kiosk(
            1,
            [
                self.component("100", category="SETTLEMENT")
                | {"component_type": "NET_PRODUCT_SALES", "fee_base": "100"},
                self.component("-10"),
            ],
            activity_date=before.isoformat(),
        )
        member = self.member(company)
        self.assertEqual(self.page(member)["total_count"], "1")
        self.assertEqual(
            self.connection.execute(
                "select source_amount from private.company_financial_totals("
                "%s,%s,%s,'v0',array[]::uuid[],array['Amazon.com'])",
                (self.seller, before, before),
            ).fetchall(),
            [(Decimal(-10),)],
        )
