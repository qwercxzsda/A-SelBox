"""Fresh-baseline lifecycle, exact calculation, immutable history and tenant checks."""

from datetime import date, timedelta
from decimal import Decimal
from typing import LiteralString, cast
from uuid import UUID

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class LiveSourceModelTests(SourceModelFixture):
    def test_fee_corrections_refund_date_and_immutable_children(self) -> None:
        company, owner = self.owner()
        first = self.fee(owner, [("2026-01-01", "2026-07-01", "5"), ("2026-07-01", None, "7")])
        self.finances(
            [
                self.transaction("100"),
                self.transaction("-100", 4, kind="Refund", activity_date="2026-07-01"),
                self.transaction("12", 5, description="Shipping"),
            ]
        )
        totals = (
            "select company_id,currency,sum(source_amount),sum(fee_amount),sum(company_amount) "
            "from public.live_company_components group by company_id,currency"
        )
        self.assertEqual(
            self.connection.execute(totals).fetchall(),
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
        self.assertEqual(
            self.connection.execute(totals).fetchall()[0][-2:], (Decimal("0"), Decimal("12"))
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.source_preprocess_batches"
            ).fetchone(),
            (2,),
        )
        for statement, values in (
            ("update public.assignment_keys set native_id='other' where id=%s", (owner,)),
            ("delete from public.assignment_keys where id=%s", (owner,)),
        ):
            with self.assertRaises(psycopg.Error), self.connection.transaction():
                self.connection.execute(cast(LiteralString, statement), values)
        with self.assertRaises(psycopg.errors.SerializationFailure), self.connection.transaction():
            self.fee(owner, [], first)
        self.assertEqual(
            str(
                require_row(
                    self.connection.execute(
                        "select current_version_id from public.assignment_keys"
                    ).fetchone()
                )[0]
            ),
            second,
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
        self.finances(rows)
        user = self.member(company)
        self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
        self.connection.execute("set local role authenticated")
        for start, end in (("2026-06-01", "2026-06-30"), ("2026-01-01", "2026-12-31")):
            expected_count = sum(
                row["sku"] == "SKU" and start <= str(row["posted_date"]) <= end for row in rows
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
