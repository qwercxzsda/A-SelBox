"""UTC transaction ordering is independent of marketplace-local accounting days."""

from decimal import Decimal
from typing import cast

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.transaction_fixtures import TransactionPageFixture
from services.sync.src.amazon.financial_channels import FINANCIAL_CHANNELS
from services.sync.src.amazon.marketplace_names import MARKETPLACE_NAME_BY_ID
from services.sync.src.finances.marketplaces import financial_marketplace_timezone


class TransactionTimestampTests(TransactionPageFixture):
    def test_database_timezone_registry_matches_source_normalization(self) -> None:
        markets = dict(MARKETPLACE_NAME_BY_ID)
        markets.update(
            {
                identifier: channel.marketplace_name
                for identifier, channel in FINANCIAL_CHANNELS.items()
            }
        )
        for identifier, name in markets.items():
            self.assertEqual(
                require_row(
                    self.connection.execute(
                        "select private.marketplace_time_zone(%s)", (name,)
                    ).fetchone()
                )[0],
                financial_marketplace_timezone(identifier).key,
            )

    def test_end_of_day_uses_next_local_midnight_and_daylight_saving(self) -> None:
        for market, day, expected in (
            ("Amazon.co.jp", "2026-11-06", "2026-11-06 14:59:59.999999+00:00"),
            ("Amazon.com", "2026-11-06", "2026-11-07 07:59:59.999999+00:00"),
            ("Amazon.com", "2026-03-08", "2026-03-09 06:59:59.999999+00:00"),
            ("Amazon.com", "2026-11-01", "2026-11-02 07:59:59.999999+00:00"),
            ("Non-Amazon US", "2026-11-06", "2026-11-07 07:59:59.999999+00:00"),
        ):
            with self.subTest(market=market, day=day):
                value = require_row(
                    self.connection.execute(
                        "select private.data_kiosk_activity_at(%s::date, %s)", (day, market)
                    ).fetchone()
                )[0]
                self.assertEqual(str(value), expected)

    def test_utc_order_filters_and_counts_keep_original_fee_dates(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-11-01", "2026-11-06", "5"), ("2026-11-06", None, "10")])
        self.finances(
            [
                self.transaction("100", 3, activity_date="2026-11-05")
                | {"posted_at": "2026-11-06T07:57:20Z"},
                self.transaction("200", 4, activity_date="2026-11-06")
                | {"marketplace_name": "Amazon.co.jp", "posted_at": "2026-11-06T00:01:00Z"},
            ]
        )
        self.kiosk(1, [self.component("-10")], activity_date="2026-11-05")
        self.connection.execute("set local timezone='Asia/Seoul'")
        user = self.member(company)
        page = self.assert_matches_view(user, p_date_from="2026-11-06", p_date_to="2026-11-06")
        rows = cast(list[dict[str, object]], page["rows"])
        self.assertEqual(page["total_count"], "3")
        self.assertEqual(
            [row["activity_at"] for row in rows],
            [
                "2026-11-06T07:59:59.999999Z",
                "2026-11-06T07:57:20.000000Z",
                "2026-11-06T00:01:00.000000Z",
            ],
        )
        us = next(
            row
            for row in rows
            if row["source"] == "FINANCES" and row["marketplace_name"] == "Amazon.com"
        )
        self.assertEqual(us["activity_date"], "2026-11-05")
        self.assertEqual(us["fee_rate_percent"], "5")
        self.assertEqual(Decimal(cast(str, us["fee_amount"])), Decimal("-5"))
        previous = self.assert_matches_view(user, p_date_from="2026-11-05", p_date_to="2026-11-05")
        self.assertEqual(previous["total_count"], "0")
        totals = cast(
            dict[str, object],
            self.as_user(
                user,
                "select public.transaction_totals(p_date_from=>'2026-11-06', "
                "p_date_to=>'2026-11-06')",
            )[0][0],
        )
        self.assertEqual(
            [
                (row["marketplace_name"], row["reported_amount"], row["row_count"])
                for row in cast(list[dict[str, object]], totals["rows"])
            ],
            [("Amazon.co.jp", "200", "1"), ("Amazon.com", "90", "2")],
        )
        for index, expected in enumerate(rows):
            one = self.page(user, p_limit=1, p_offset=index)
            self.assertEqual(one["rows"], [expected])

    def test_unfiltered_one_row_page_supplies_the_shared_utc_anchor_under_rls(self) -> None:
        company, _ = self.owner()
        other, _ = self.owner("OTHER")
        self.finances(
            [
                self.transaction("1", 3, activity_date="2026-11-05")
                | {"posted_at": "2026-11-06T07:57:20Z"},
                self.transaction("2", 4, activity_date="2026-11-07")
                | {"marketplace_name": "Amazon.co.jp", "posted_at": "2026-11-06T23:40:33Z"},
                self.transaction("3", 5, activity_date="2026-11-08", sku="OTHER"),
            ]
        )
        member = self.member(company)
        administrator = self.administrator()
        options = {"p_limit": 1, "p_include_count": False, "p_direction": "desc"}
        latest = self.assert_matches_view(member, **options)
        self.assertIsNone(latest["total_count"])
        rows = cast(list[dict[str, object]], latest["rows"])
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["marketplace_name"], "Amazon.co.jp")
        self.assertEqual(row["activity_at"], "2026-11-06T23:40:33.000000Z")
        self.assertEqual(row["activity_date"], "2026-11-07")
        unfiltered = self.assert_matches_view(administrator, **options)
        row = cast(list[dict[str, object]], unfiltered["rows"])[0]
        self.assertTrue(cast(str, row["activity_at"]).startswith("2026-11-08"))
        other_member = self.assert_matches_view(self.member(other), **options)
        self.assertEqual(other_member["rows"], unfiltered["rows"])
        self.assertEqual(self.assert_matches_view(self.auth_user(), **options)["rows"], [])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute(
                "select public.transaction_page(p_limit=>1,p_include_count=>false)"
            )

    def test_utc_day_includes_start_midnight_and_excludes_next_midnight(self) -> None:
        company, _ = self.owner()
        self.finances(
            [
                self.transaction(str(index), index, activity_date=day) | {"posted_at": instant}
                for index, day, instant in (
                    (1, "2026-11-05", "2026-11-05T23:59:59.999999Z"),
                    (2, "2026-11-05", "2026-11-06T00:00:00Z"),
                    (3, "2026-11-06", "2026-11-06T23:59:59.999999Z"),
                    (4, "2026-11-06", "2026-11-07T00:00:00Z"),
                )
            ]
        )
        user = self.member(company)
        result = self.assert_matches_view(user, p_date_from="2026-11-06", p_date_to="2026-11-06")
        self.assertEqual(
            [row["source_amount"] for row in cast(list[dict[str, object]], result["rows"])],
            ["3", "2"],
        )
        totals = cast(
            dict[str, object],
            self.as_user(
                user,
                "select public.transaction_totals(p_date_from=>'2026-11-06', "
                "p_date_to=>'2026-11-06')",
            )[0][0],
        )
        self.assertEqual(cast(list[dict[str, object]], totals["rows"])[0]["reported_amount"], "5")

    def test_daily_cost_end_of_day_can_anchor_the_next_utc_month(self) -> None:
        company, _ = self.owner()
        self.kiosk(1, [self.component("-10")], activity_date="2026-11-30")
        user = self.member(company)
        latest = self.assert_matches_view(user, p_limit=1, p_include_count=False)
        self.assertEqual(
            cast(list[dict[str, object]], latest["rows"])[0]["activity_at"],
            "2026-12-01T07:59:59.999999Z",
        )
        self.assertIsNone(latest["total_count"])
        totals = cast(
            dict[str, object],
            self.as_user(
                user,
                "select public.transaction_totals(p_date_from=>'2026-12-01',"
                "p_date_to=>'2026-12-01')",
            )[0][0],
        )
        self.assertEqual(cast(list[dict[str, object]], totals["rows"])[0]["reported_amount"], "-10")
        self.assertEqual(
            self.page(user, p_date_from="2026-11-30", p_date_to="2026-11-30")["rows"], []
        )
