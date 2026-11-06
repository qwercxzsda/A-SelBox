"""Current monthly source review remains administrator-only and separate from payouts."""

from datetime import date, timedelta
from decimal import Decimal
from typing import LiteralString, cast

from psycopg.errors import InvalidParameterValue

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id

_TOTALS_FROM: LiteralString = (
    "from unnest(array['FINANCES','DATA_KIOSK','SELBOX']::public.allocation_category[]) c(k) "
    "cross join (select distinct marketplace_name from public.financial_review_records) m "
    "cross join lateral public.financial_review_totals("
    "'2026-06-01','2026-08-01',c.k,m.marketplace_name) t "
)
_TOTALS: LiteralString = (
    "select month,category::text,t.marketplace_name,currency,finances_amount,data_kiosk_amount,"
    "difference,finances_row_count,data_kiosk_row_count "
    + _TOTALS_FROM
    + "order by month,category::text,t.marketplace_name,currency"
)
_REVIEW_CATEGORIES = ("FINANCES", "DATA_KIOSK", "SELBOX")


class FinancialReviewAccessTests(SourceModelFixture):
    def _publish_review_month_boundary(self, cutoff: date, latest_month: date) -> date:
        frontier = cutoff.replace(day=1)
        # Retain a precise amount and a zero in the complete month; large amounts
        # in the next month make accidental inclusion visible in every category.
        day_amounts = {
            latest_month: ("10.000000001", "7.000000001"),
            frontier - timedelta(days=1): ("0", "0"),
            frontier: ("999", "888"),
            cutoff: ("999", "888"),
        }
        transactions: list[dict[str, object]] = []
        kiosk_days: dict[date, list[dict[str, object]]] = {}
        for day, (finances_amount, kiosk_amount) in sorted(day_amounts.items()):
            kiosk_days[day] = []
            for category in _REVIEW_CATEGORIES:
                transaction = self.transaction(
                    finances_amount,
                    len(transactions) + 1,
                    activity_date=day.isoformat(),
                    kind="Shipment" if category == "FINANCES" else "ServiceFee",
                    category=category,
                )
                component = self.component(kiosk_amount, category=category)
                if category == "SELBOX":
                    transaction["sku"] = component["sku"] = None
                transactions.append(transaction)
                kiosk_days[day].append(component)
        self.finances(transactions)
        for day, components in kiosk_days.items():
            self.kiosk(20, components, activity_date=day.isoformat())
        return frontier

    def test_only_complete_mature_months_match_payout_policy_at_calendar_boundaries(self) -> None:
        for cutoff, latest_month in (
            (date(2026, 8, 18), date(2026, 7, 1)),
            (date(2026, 9, 1), date(2026, 8, 1)),
            (date(2024, 3, 1), date(2024, 2, 1)),
            (date(2025, 3, 1), date(2025, 2, 1)),
            (date(2026, 1, 18), date(2025, 12, 1)),
            (date(2026, 1, 1), date(2025, 12, 1)),
        ):
            with self.subTest(cutoff=cutoff), self.connection.transaction(force_rollback=True):
                self.set_mature_cutoff_date(cutoff)
                self.connection.execute("set local timezone='Pacific/Kiritimati'")
                frontier = self._publish_review_month_boundary(cutoff, latest_month)
                administrator = self.administrator()
                self.assertEqual(
                    self.as_user(
                        administrator,
                        "select (public.payout_report_policy()->>'latest_month')::date",
                    ),
                    [(latest_month,)],
                )
                self.assertEqual(
                    self.as_user(
                        administrator,
                        "select activity_date,count(*) from public.financial_review_records "
                        "group by activity_date order by activity_date",
                    ),
                    [(latest_month, 6), (frontier - timedelta(days=1), 6)],
                )
                # Request through the partial month so both RPCs must enforce the
                # same complete-month eligibility as records and payout policy.
                period_end = (frontier + timedelta(days=32)).replace(day=1)
                for category in _REVIEW_CATEGORIES:
                    self.assertEqual(
                        self.as_user(
                            administrator,
                            "select month,finances_amount,data_kiosk_amount,difference,"
                            "finances_row_count,data_kiosk_row_count "
                            "from public.financial_review_totals(%s,%s,%s,'Amazon.com')",
                            (latest_month, period_end, category),
                        ),
                        [
                            (
                                latest_month,
                                Decimal("10.000000001"),
                                Decimal("7.000000001"),
                                3,
                                2,
                                2,
                            )
                        ],
                    )
                    self.assertEqual(
                        self.as_user(
                            administrator,
                            "select month,source,amount,row_count "
                            "from public.financial_review_type_totals(%s,%s,%s,'USD','Amazon.com') "
                            "order by source",
                            (latest_month, period_end, category),
                        ),
                        [
                            (latest_month, "DATA_KIOSK", Decimal("7.000000001"), 2),
                            (latest_month, "FINANCES", Decimal("10.000000001"), 2),
                        ],
                    )
                self.connection.execute("set constraints all immediate")

    def test_partial_month_exclusion_does_not_change_raw_sources_or_daily_transaction_authority(
        self,
    ) -> None:
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
        self.assertEqual(
            self.as_user(
                administrator,
                "select count(*) from public.financial_review_records",
            ),
            [(0,)],
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
                ("DATA_KIOSK", "2026-08-18", "107"),
                ("FINANCES", "2026-08-01", "11"),
                ("FINANCES", "2026-08-17", "13"),
                ("RECONCILIATION", "2026-08-01", "1"),
                ("RECONCILIATION", "2026-08-17", "1"),
            ],
        )
        self.connection.execute("set constraints all immediate")

    def test_invoker_security_and_administrator_gate_cover_records_and_summaries(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
        company, _ = self.owner()
        self.finances([self.transaction("100")])
        self.kiosk(1, [self.component("-10")])
        self.assertEqual(
            self.connection.execute(
                "select c.relname,'security_invoker=true'=any(c.reloptions),"
                "has_table_privilege('authenticated',c.oid,'SELECT'),"
                "has_table_privilege('anon',c.oid,'SELECT'),"
                "has_table_privilege('service_role',c.oid,'SELECT') "
                "from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                "where n.nspname='public' and c.relname='financial_review_records'"
            ).fetchall(),
            [("financial_review_records", True, True, False, False)],
        )
        self.assertEqual(
            self.connection.execute(
                "select p.proname,not p.prosecdef,p.provolatile,"
                "has_function_privilege('authenticated',p.oid,'EXECUTE'),"
                "has_function_privilege('anon',p.oid,'EXECUTE'),"
                "has_function_privilege('service_role',p.oid,'EXECUTE') "
                "from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                "where n.nspname='public' and p.proname in "
                "('financial_review_totals','financial_review_type_totals') order by p.proname"
            ).fetchall(),
            [
                ("financial_review_totals", True, "s", True, False, False),
                ("financial_review_type_totals", True, "s", True, False, False),
            ],
        )
        query: LiteralString = (
            "select 'records',count(*) from public.financial_review_records "
            "union all select 'totals',count(*) from public.financial_review_totals("
            "'2026-06-01','2026-07-01','DATA_KIOSK','Amazon.com') "
            "union all select 'types',count(*) from public.financial_review_type_totals("
            "'2026-06-01','2026-07-01','DATA_KIOSK','USD','Amazon.com')"
        )
        self.assertEqual(
            self.as_user(self.administrator(), query), [("records", 2), ("totals", 1), ("types", 1)]
        )
        for user in (self.member(company), self.auth_user()):
            self.assertEqual(
                self.as_user(user, query), [("records", 0), ("totals", 0), ("types", 0)]
            )

    def test_categories_scope_zero_rows_precision_and_totals_agree(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
        # Review includes unowned account source facts without company/fee joins.
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
            (date(2026, 6, 1), "DATA_KIOSK", "Amazon.com", "EUR", 0, -4, 4, 0, 1),
            (
                date(2026, 6, 1),
                "DATA_KIOSK",
                "Amazon.com",
                "USD",
                0,
                Decimal("-15.000000001"),
                Decimal("15.000000001"),
                0,
                2,
            ),
            (date(2026, 6, 1), "DATA_KIOSK", "Non-Amazon US", "USD", -20, 0, -20, 1, 0),
            (date(2026, 6, 1), "DATA_KIOSK", "Amazon.ca", "USD", -5, 0, -5, 1, 0),
            (date(2026, 6, 1), "SELBOX", "Non-Amazon US", "USD", -3, 0, -3, 1, 0),
            (date(2026, 6, 1), "SELBOX", "Amazon.com", "USD", 0, 0, 0, 0, 1),
            (
                date(2026, 6, 1),
                "FINANCES",
                "Amazon.com",
                "USD",
                Decimal("100.123456789"),
                Decimal("97.123456788"),
                Decimal("3.000000001"),
                2,
                1,
            ),
            (date(2026, 7, 1), "DATA_KIOSK", "Amazon.com", "USD", 0, -2, 2, 0, 1),
        ]
        expected.sort(key=lambda row: row[:4])
        self.assertEqual(self.as_user(administrator, _TOTALS), expected)
        self.assertEqual(
            self.as_user(
                administrator,
                "select count(*),count(*) filter(where amount=0),"
                "count(*) filter(where marketplace_name is null),"
                "count(distinct seller_namespace) from public.financial_review_records",
            ),
            [(11, 3, 0, 2)],
        )
        # Every source-specific Type sum and count rolls up to its month/category.
        self.assertEqual(
            self.as_user(
                administrator,
                # The shared FROM clause is a repository-owned LiteralString.
                "select t.month,t.category::text,t.marketplace_name,t.currency "  # noqa: S608
                + _TOTALS_FROM
                + "cross join lateral (select "
                "coalesce(sum(amount) filter(where source='FINANCES'),0) s,"
                "coalesce(sum(amount) filter(where source='DATA_KIOSK'),0) d,"
                "coalesce(sum(row_count) filter(where source='FINANCES'),0) sc,"
                "coalesce(sum(row_count) filter(where source='DATA_KIOSK'),0) dc "
                "from public.financial_review_type_totals(t.month,"
                "(t.month + interval '1 month')::date,t.category,t.currency,t.marketplace_name)) a "
                "where (t.finances_amount,t.data_kiosk_amount,t.difference,"
                "t.finances_row_count,t.data_kiosk_row_count) is distinct from "
                "(a.s,a.d,a.s-a.d,a.sc,a.dc)",
            ),
            [],
        )
        self.connection.execute("set local timezone='Pacific/Kiritimati'")
        self.assertEqual(self.as_user(administrator, _TOTALS), expected)
        self.assertEqual(
            self.as_user(
                administrator,
                "select count(*) from public.financial_review_records "
                "where activity_date>='2026-07-01' and activity_date<'2026-08-01' "
                "and category='DATA_KIOSK' and currency='USD'",
            ),
            [(1,)],
        )
        self.connection.execute("set constraints all immediate")

    def test_summaries_require_explicit_valid_month_and_category_scope(self) -> None:
        query: LiteralString = "select * from public.financial_review_totals(%s,%s,%s,'Amazon.com')"
        administrator = self.administrator()
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
        self.set_mature_cutoff_date(date(2026, 8, 1))
        acquisition = self.acquisition()
        _, _old_finances = self.finances([self.transaction("100")], acquisition_id=acquisition)
        _, new_finances = self.finances(
            [self.transaction("50")],
            acquisition_id=acquisition,
            version="v1",
        )
        _, old_kiosk = self.kiosk(1, [self.component("-10")])
        _, new_kiosk = self.kiosk(2, [self.component("-5")], expected=old_kiosk, digest="b")
        administrator = self.administrator()
        self.assertEqual(
            self.as_user(
                administrator,
                "select source,source_version_id::text,count(*) "
                "from public.financial_review_records group by source,source_version_id "
                "order by source",
            ),
            [("DATA_KIOSK", new_kiosk, 1), ("FINANCES", new_finances, 1)],
        )
        self.assertEqual(
            self.connection.execute(
                "select (select count(*) from private.finances_transaction_components),"
                "(select count(*) from private.data_kiosk_transactions)"
            ).fetchone(),
            (2, 2),
        )
        self.connection.execute("set constraints all immediate")

    def test_same_euro_marketplaces_remain_separate_in_totals_types_and_records(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
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
                            "expected_current_version_id": None,
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
        for market, difference, finances_count in (
            ("Amazon.de", Decimal("10.000000009"), 2),
            ("Amazon.fr", Decimal("2.000000009"), 1),
        ):
            with self.subTest(market=market):
                self.assertEqual(
                    self.as_user(
                        administrator,
                        "select marketplace_name,currency,difference,"
                        "finances_row_count,data_kiosk_row_count "
                        "from public.financial_review_totals("
                        "'2026-06-01','2026-07-01','FINANCES',%s)",
                        (market,),
                    ),
                    [(market, "EUR", difference, finances_count, 1)],
                )
                types = self.as_user(
                    administrator,
                    "select marketplace_name,currency,source,amount,row_count "
                    "from public.financial_review_type_totals("
                    "'2026-06-01','2026-07-01','FINANCES','EUR',%s) order by source",
                    (market,),
                )
                self.assertEqual(len(types), 2)
                self.assertTrue(all(row[:2] == (market, "EUR") for row in types))
                self.assertEqual(
                    cast(Decimal, types[1][3]) - cast(Decimal, types[0][3]), difference
                )
                self.assertEqual([row[4] for row in types], [1, finances_count])
                self.assertEqual(
                    self.as_user(
                        administrator,
                        "select marketplace_name,currency,count(*) "
                        "from public.financial_review_records "
                        "where marketplace_name=%s and category='FINANCES' "
                        "group by marketplace_name,currency",
                        (market,),
                    ),
                    [(market, "EUR", finances_count + 1)],
                )
        self.connection.execute("set constraints all immediate")

    def test_marketplace_is_explicit_and_cannot_be_inferred_or_widened(self) -> None:
        administrator = self.administrator()
        for market in (None, "", "Germany", "Amazon.de,Amazon.fr", "Amazon.de' or true--"):
            for query in (
                "select * from public.financial_review_totals("
                "'2026-06-01','2026-07-01','FINANCES',%s)",
                "select * from public.financial_review_type_totals("
                "'2026-06-01','2026-07-01','FINANCES','EUR',%s)",
            ):
                with self.subTest(market=market), self.assertRaises(InvalidParameterValue):
                    self.as_user(administrator, query, (market,))

    def test_category_summaries_keep_zero_records_without_inventing_empty_categories(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
        self.finances(
            [
                self.transaction("0", line, kind="ServiceFee", category="SELBOX") | {"sku": None}
                for line in (3, 4)
            ]
        )
        administrator = self.administrator()
        for category in ("FINANCES", "DATA_KIOSK"):
            self.assertEqual(
                self.as_user(
                    administrator,
                    "select * from public.financial_review_totals("
                    "'2026-06-01','2026-07-01',%s,'Amazon.com')",
                    (category,),
                ),
                [],
            )
        self.assertEqual(
            self.as_user(
                administrator,
                "select finances_amount,data_kiosk_amount,difference,"
                "finances_row_count,data_kiosk_row_count "
                "from public.financial_review_totals("
                "'2026-06-01','2026-07-01','SELBOX','Amazon.com')",
            ),
            [(0, 0, 0, 2, 0)],
        )
