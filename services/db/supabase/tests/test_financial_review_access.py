"""Administrator source reads retain explicit scopes, native values, and type detail."""

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import LiteralString, cast

import psycopg
from psycopg.errors import InvalidParameterValue

from services.db.supabase.tests.source_fixtures import SourceModelFixture, kiosk_timestamp, new_id


class FinancialReviewAccessTests(SourceModelFixture):
    def source_totals(
        self,
        user: str,
        *,
        start: date = date(2026, 6, 1),
        end: date = date(2026, 7, 31),
        marketplace: str = "Amazon.com",
        category: str | None = None,
    ) -> list[tuple[str, str, str, str, str, Decimal, int]]:
        result = cast(
            dict[str, object],
            self.as_user(
                user,
                "select public.current_source_totals(%s,%s,%s,'month',null,%s)",
                (start, end, marketplace, category),
            )[0][0],
        )
        return sorted(
            (
                row["period"],
                row["source"],
                row["category"],
                row["marketplace_name"],
                row["currency"],
                Decimal(row["amount"]),
                int(row["row_count"]),
            )
            for row in cast(list[dict[str, str]], result["rows"])
        )

    def test_explicit_calendar_ranges_do_not_depend_on_maturity(self) -> None:
        for cutoff in (date(2026, 8, 18), date(2024, 3, 1), date(2026, 1, 1)):
            with self.subTest(cutoff=cutoff), self.connection.transaction(force_rollback=True):
                self.set_mature_cutoff_date(cutoff)
                frontier = cutoff.replace(day=1)
                earlier = frontier - timedelta(days=1)
                start = earlier.replace(day=1)
                end = (frontier + timedelta(days=32)).replace(day=1)
                # Historical calendar fixtures must remain within the acquisition's
                # two-year source horizon regardless of the current wall clock.
                acquisition = self.acquisition(
                    start=start.isoformat(),
                    end=(end - timedelta(days=1)).isoformat(),
                    observed_at=datetime.combine(end, time.min, UTC) + timedelta(days=1),
                )
                self.finances(
                    [
                        self.transaction("10.000000001", activity_date=earlier.isoformat()),
                        self.transaction("999", 4, activity_date=frontier.isoformat()),
                    ],
                    acquisition_id=acquisition,
                )
                self.kiosk(
                    1,
                    [self.component("7.000000001", category="FINANCES")],
                    activity_date=earlier.isoformat(),
                )
                self.kiosk(
                    2,
                    [self.component("888", category="FINANCES")],
                    activity_date=frontier.isoformat(),
                )
                administrator = self.administrator()
                expected = [
                    (
                        start.isoformat(),
                        "DATA_KIOSK",
                        "FINANCES",
                        "Amazon.com",
                        "USD",
                        Decimal("7.000000001"),
                        1,
                    ),
                    (
                        start.isoformat(),
                        "FINANCES",
                        "FINANCES",
                        "Amazon.com",
                        "USD",
                        Decimal("10.000000001"),
                        1,
                    ),
                    (
                        frontier.isoformat(),
                        "DATA_KIOSK",
                        "FINANCES",
                        "Amazon.com",
                        "USD",
                        Decimal(888),
                        1,
                    ),
                    (
                        frontier.isoformat(),
                        "FINANCES",
                        "FINANCES",
                        "Amazon.com",
                        "USD",
                        Decimal(999),
                        1,
                    ),
                ]
                self.assertEqual(
                    self.source_totals(administrator, start=start, end=end - timedelta(days=1)),
                    expected,
                )
                self.assertEqual(
                    self.as_user(
                        administrator,
                        "select month,source,amount,row_count "
                        "from public.financial_review_type_totals("
                        "%s,%s,'FINANCES','USD','Amazon.com') order by month,source",
                        (start, end),
                    ),
                    [(date.fromisoformat(row[0]), row[1], row[5], row[6]) for row in expected],
                )
                self.assertEqual(
                    self.as_user(
                        administrator, "select count(*) from public.financial_review_records"
                    ),
                    [(4,)],
                )
                self.connection.execute("set local timezone='Pacific/Kiritimati'")
                self.set_mature_cutoff_date(date(2000, 1, 1))
                self.assertEqual(
                    self.source_totals(administrator, start=start, end=end - timedelta(days=1)),
                    expected,
                )

    def test_review_scope_does_not_change_raw_sources_or_daily_transaction_authority(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 18))
        dates = ("2026-08-01", "2026-08-17", "2026-08-18")
        self.finances(
            [
                self.transaction(amount, index + 1, activity_date=day)
                for index, (day, amount) in enumerate(zip(dates, ("11", "13", "17"), strict=True))
            ]
        )
        for day, amount in zip(dates, ("101", "103", "107"), strict=True):
            self.kiosk(
                1,
                [self.component(amount, category="FINANCES"), self.component("-1")],
                activity_date=day,
            )
        administrator = self.administrator()
        self.assertEqual(self.source_totals(administrator), [])
        self.assertEqual(
            self.as_user(administrator, "select count(*) from public.financial_review_records"),
            [(9,)],
        )
        self.assertEqual(
            self.as_user(
                administrator,
                "select jsonb_array_length(public.source_transaction_page('finances')->'rows'),"
                "jsonb_array_length(public.source_transaction_page('data_kiosk')->'rows')",
            ),
            [(3, 6)],
        )
        self.assertEqual(
            self.as_user(
                administrator,
                "select r->>'source',r->>'activity_date',r->>'source_amount' "
                "from jsonb_array_elements(public.transaction_page(p_limit=>100)->'rows') r "
                "order by r->>'source',r->>'activity_date',r->>'source_amount'",
            ),
            [
                ("DATA_KIOSK", "2026-08-01", "-1"),
                ("DATA_KIOSK", "2026-08-17", "-1"),
                ("DATA_KIOSK", "2026-08-18", "-1"),
                ("FINANCES", "2026-08-01", "11"),
                ("FINANCES", "2026-08-17", "13"),
                ("FINANCES", "2026-08-18", "17"),
            ],
        )

    def test_invoker_security_and_administrator_gate_cover_records_types_and_totals(self) -> None:
        company, _ = self.owner()
        self.finances([self.transaction("100")])
        self.kiosk(1, [self.component("-10")])
        self.assertEqual(
            self.connection.execute(
                "select 'security_invoker=true'=any(c.reloptions),"
                "has_table_privilege('authenticated',c.oid,'SELECT'),"
                "has_table_privilege('anon',c.oid,'SELECT'),"
                "has_table_privilege('service_role',c.oid,'SELECT') "
                "from pg_class c where c.oid='public.financial_review_records'::regclass"
            ).fetchone(),
            (True, True, False, False),
        )
        self.assertEqual(
            self.connection.execute(
                "select p.proname,not p.prosecdef,p.provolatile,"
                "has_function_privilege('authenticated',p.oid,'EXECUTE'),"
                "has_function_privilege('anon',p.oid,'EXECUTE'),"
                "has_function_privilege('service_role',p.oid,'EXECUTE') "
                "from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='public' and p.proname in "
                "('current_source_totals','financial_review_type_totals') order by p.proname"
            ).fetchall(),
            [
                ("current_source_totals", True, "s", True, False, False),
                ("financial_review_type_totals", True, "s", True, False, False),
            ],
        )
        query: LiteralString = (
            "select 'records',count(*) from public.financial_review_records "
            "union all select 'types',count(*) from public.financial_review_type_totals("
            "'2026-06-01','2026-07-01','DATA_KIOSK','USD','Amazon.com')"
        )
        administrator = self.administrator()
        self.assertEqual(self.as_user(administrator, query), [("records", 2), ("types", 1)])
        self.assertEqual(len(self.source_totals(administrator)), 2)
        for user in (self.member(company), self.auth_user()):
            self.assertEqual(self.as_user(user, query), [("records", 0), ("types", 0)])
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.source_totals(user)

    def test_categories_precision_zeros_and_native_type_sums_match(self) -> None:
        self.finances(
            [
                self.transaction("100.123456789"),
                self.transaction("0", 4),
                self.transaction("-20", 5, kind="ServiceFee", category="DATA_KIOSK")
                | {"marketplace_name": "Non-Amazon US"},
                self.transaction("-3", 6, kind="ServiceFee", category="SELBOX")
                | {"sku": None, "marketplace_name": "Non-Amazon US"},
                self.transaction("1000", 7, activity_date="2026-08-01"),
            ]
        )
        self.kiosk(
            1,
            [
                self.component("97.123456788", category="FINANCES")
                | {"component_type": "NET_PRODUCT_SALES"},
                self.component("-15.000000001"),
                self.component("0"),
                self.component("-4") | {"currency": "EUR"},
                self.component("-900", category="ANALYSIS_ONLY"),
            ],
        )
        self.kiosk(1, [self.component("-999")], activity_date="2026-08-01")
        self.kiosk(1, [self.component("-2")], activity_date="2026-07-01")
        self.seller = "seller-two"
        self.finances(
            [self.transaction("-5", category="DATA_KIOSK") | {"marketplace_name": "Amazon.ca"}]
        )
        self.kiosk(1, [self.component("0", category="SELBOX") | {"sku": None}])
        administrator = self.administrator()
        expected = [
            ("2026-06-01", "DATA_KIOSK", "DATA_KIOSK", "Amazon.com", "EUR", Decimal(-4), 1),
            (
                "2026-06-01",
                "DATA_KIOSK",
                "DATA_KIOSK",
                "Amazon.com",
                "USD",
                Decimal("-15.000000001"),
                2,
            ),
            (
                "2026-06-01",
                "DATA_KIOSK",
                "FINANCES",
                "Amazon.com",
                "USD",
                Decimal("97.123456788"),
                1,
            ),
            ("2026-06-01", "DATA_KIOSK", "SELBOX", "Amazon.com", "USD", Decimal(0), 1),
            ("2026-06-01", "FINANCES", "DATA_KIOSK", "Amazon.ca", "USD", Decimal(-5), 1),
            ("2026-06-01", "FINANCES", "DATA_KIOSK", "Non-Amazon US", "USD", Decimal(-20), 1),
            (
                "2026-06-01",
                "FINANCES",
                "FINANCES",
                "Amazon.com",
                "USD",
                Decimal("100.123456789"),
                2,
            ),
            ("2026-06-01", "FINANCES", "SELBOX", "Non-Amazon US", "USD", Decimal(-3), 1),
            ("2026-07-01", "DATA_KIOSK", "DATA_KIOSK", "Amazon.com", "USD", Decimal(-2), 1),
        ]
        actual = [
            row
            for market in ("Amazon.com", "Amazon.ca", "Non-Amazon US")
            for row in self.source_totals(administrator, marketplace=market)
        ]
        self.assertCountEqual(actual, expected)
        self.assertEqual(
            self.as_user(
                administrator,
                "select count(*),count(*) filter(where amount=0),count(distinct seller_namespace) "
                "from public.financial_review_records",
            ),
            [(13, 3, 2)],
        )
        for month, source, category, market, currency, amount, count in expected:
            start = date.fromisoformat(month)
            end = (start + timedelta(days=32)).replace(day=1)
            self.assertEqual(
                self.as_user(
                    administrator,
                    "select sum(amount),sum(row_count) from public.financial_review_type_totals("
                    "%s,%s,%s,%s,%s) where source=%s",
                    (start, end, category, currency, market, source),
                ),
                [(amount, count)],
            )
        self.connection.execute("set local timezone='Pacific/Kiritimati'")
        self.assertCountEqual(
            [
                row
                for market in ("Amazon.com", "Amazon.ca", "Non-Amazon US")
                for row in self.source_totals(administrator, marketplace=market)
            ],
            expected,
        )

    def test_type_totals_require_valid_explicit_month_category_and_currency(self) -> None:
        administrator = self.administrator()
        query: LiteralString = (
            "select * from public.financial_review_type_totals(%s,%s,%s,'USD','Amazon.com')"
        )
        for scope in (
            (None, "2026-07-01", "DATA_KIOSK"),
            ("2026-06-01", None, "DATA_KIOSK"),
            ("2026-06-01", "2026-07-01", None),
            ("2026-06-02", "2026-07-01", "DATA_KIOSK"),
            ("2026-06-01", "2026-07-02", "DATA_KIOSK"),
            ("2026-07-01", "2026-06-01", "DATA_KIOSK"),
            ("2026-06-01", "2026-06-01", "DATA_KIOSK"),
            ("2026-06-01", "infinity", "DATA_KIOSK"),
            ("2026-06-01", "2026-07-01", "ANALYSIS_ONLY"),
        ):
            with self.subTest(scope=scope), self.assertRaises(InvalidParameterValue):
                self.as_user(administrator, query, scope)
        for currency in (None, "", "usd", "USD,EUR"):
            with self.subTest(currency=currency), self.assertRaises(InvalidParameterValue):
                self.as_user(
                    administrator,
                    "select * from public.financial_review_type_totals("
                    "'2026-06-01','2026-07-01','DATA_KIOSK',%s,'Amazon.com')",
                    (currency,),
                )

    def test_replacing_current_versions_does_not_count_retained_history(self) -> None:
        acquisition = self.acquisition()
        self.finances([self.transaction("100")], acquisition_id=acquisition)
        _, finances = self.finances(
            [self.transaction("50")], acquisition_id=acquisition, version="v1"
        )
        _, old = self.kiosk(1, [self.component("-10")])
        _, kiosk = self.kiosk(2, [self.component("-5")], expected=old)
        self.assertEqual(
            self.as_user(
                self.administrator(),
                "select source,source_version_id::text,count(*) "
                "from public.financial_review_records "
                "group by source,source_version_id order by source",
            ),
            [("DATA_KIOSK", kiosk, 1), ("FINANCES", finances, 1)],
        )
        self.assertEqual(
            self.connection.execute(
                "select (select count(*) from private.finances_transaction_components),"
                "(select count(*) from private.data_kiosk_day_components)"
            ).fetchone(),
            (2, 2),
        )

    def test_same_currency_markets_remain_separate_in_totals_types_and_records(self) -> None:
        self.finances(
            [
                self.transaction("100.123456789")
                | {"marketplace_name": "Amazon.de", "currency": "EUR"},
                self.transaction("0", 4) | {"marketplace_name": "Amazon.de", "currency": "EUR"},
                self.transaction("20.123456789", 5)
                | {"marketplace_name": "Amazon.fr", "currency": "EUR"},
            ]
        )
        for market, identifier, amount in (
            ("Amazon.de", "A1PA6795UKMFR9", "90.123456780"),
            ("Amazon.fr", "A13V1IB3VIYZZH", "18.123456780"),
        ):
            self.call(
                "publish_data_kiosk_preprocess",
                {
                    "id": new_id(),
                    "acquisition_id": self.kiosk_acquisition(
                        1, marketplace_id=identifier, amazon_scope="EU"
                    ),
                    "preprocess_version": "v0",
                    "dataset_key": "economics",
                    "days": [
                        {
                            "id": new_id(),
                            "marketplace_name": market,
                            "activity_date": "2026-06-15",
                            "activity_at": kiosk_timestamp("2026-06-15", market),
                            "expected_current_version_id": None,
                            "expected_current_batch_id": None,
                            "content_sha256": "c" * 64,
                            "transactions": [
                                self.component(amount, category="FINANCES")
                                | {"currency": "EUR", "component_type": "NET_PRODUCT_SALES"}
                            ],
                        }
                    ],
                },
            )
        administrator = self.administrator()
        for market, sales, estimate, count in (
            ("Amazon.de", "100.123456789", "90.123456780", 2),
            ("Amazon.fr", "20.123456789", "18.123456780", 1),
        ):
            with self.subTest(market=market):
                self.assertEqual(
                    self.source_totals(administrator, marketplace=market, category="FINANCES"),
                    [
                        (
                            "2026-06-01",
                            "DATA_KIOSK",
                            "FINANCES",
                            market,
                            "EUR",
                            Decimal(estimate),
                            1,
                        ),
                        (
                            "2026-06-01",
                            "FINANCES",
                            "FINANCES",
                            market,
                            "EUR",
                            Decimal(sales),
                            count,
                        ),
                    ],
                )
                self.assertEqual(
                    self.as_user(
                        administrator,
                        "select source,amount,row_count from public.financial_review_type_totals("
                        "'2026-06-01','2026-07-01','FINANCES','EUR',%s) order by source",
                        (market,),
                    ),
                    [("DATA_KIOSK", Decimal(estimate), 1), ("FINANCES", Decimal(sales), count)],
                )
                self.assertEqual(
                    self.as_user(
                        administrator,
                        "select count(*) from public.financial_review_records "
                        "where marketplace_name=%s",
                        (market,),
                    ),
                    [(count + 1,)],
                )

    def test_marketplace_cannot_be_inferred_or_widened(self) -> None:
        administrator = self.administrator()
        for market in (None, "", "Germany", "Amazon.de,Amazon.fr", "Amazon.de' or true--"):
            for query in (
                "select public.current_source_totals('2026-06-01','2026-06-30',%s)",
                "select * from public.financial_review_type_totals("
                "'2026-06-01','2026-07-01','FINANCES','EUR',%s)",
            ):
                with self.subTest(market=market), self.assertRaises(InvalidParameterValue):
                    self.as_user(administrator, query, (market,))

    def test_zero_source_rows_are_retained_without_inventing_empty_categories(self) -> None:
        self.finances(
            [
                self.transaction("0", line, kind="ServiceFee", category="SELBOX") | {"sku": None}
                for line in (3, 4)
            ]
        )
        administrator = self.administrator()
        for category in ("FINANCES", "DATA_KIOSK"):
            self.assertEqual(self.source_totals(administrator, category=category), [])
        self.assertEqual(
            self.source_totals(administrator, category="SELBOX"),
            [
                ("2026-06-01", "FINANCES", "SELBOX", "Amazon.com", "USD", Decimal(0), 2),
            ],
        )
