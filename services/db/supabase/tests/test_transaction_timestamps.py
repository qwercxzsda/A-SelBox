"""UTC transaction ordering is independent of marketplace-local accounting days."""

from typing import cast

import psycopg

from services.db.supabase.tests.transaction_fixtures import TransactionPageFixture


class TransactionTimestampTests(TransactionPageFixture):
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
