"""Current monthly source review remains operator-only and separate from payouts."""

from datetime import date
from decimal import Decimal
from typing import LiteralString

from psycopg.errors import InvalidParameterValue

from services.db.supabase.tests.source_fixtures import SourceModelFixture

_TOTALS_FROM: LiteralString = (
    "from unnest(array['SETTLEMENT','DATA_KIOSK','SELBOX']::public.allocation_category[]) c(k) "
    "cross join lateral public.financial_review_totals('2026-06-01','2026-08-01',c.k) t "
)
_TOTALS: LiteralString = (
    "select month,category::text,currency,settlement_amount,data_kiosk_amount,"
    "difference,settlement_row_count,data_kiosk_row_count "
    + _TOTALS_FROM
    + "order by month,category::text,currency"
)


class FinancialReviewAccessTests(SourceModelFixture):
    def test_invoker_security_and_operator_gate_cover_records_and_summaries(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
        company, _ = self.owner()
        self.settlement([self.transaction("100")])
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
            "'2026-06-01','2026-07-01','DATA_KIOSK') "
            "union all select 'types',count(*) from public.financial_review_type_totals("
            "'2026-06-01','2026-07-01','DATA_KIOSK','USD')"
        )
        self.assertEqual(
            self.as_user(self.operator(), query), [("records", 2), ("totals", 1), ("types", 1)]
        )
        for user in (self.member(company), self.auth_user()):
            self.assertEqual(
                self.as_user(user, query), [("records", 0), ("totals", 0), ("types", 0)]
            )

    def test_categories_scope_zero_rows_precision_and_totals_agree(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
        # Review includes unowned account source facts without company/fee joins.
        self.settlement(
            [
                self.transaction("100.123456789"),
                self.transaction("0", 4),
                self.transaction("-20", 5, kind="ServiceFee", category="DATA_KIOSK")
                | {"marketplace_name": None},
                self.transaction("-3", 6, kind="ServiceFee", category="SELBOX")
                | {"sku": None, "family": None, "marketplace_name": None},
                self.transaction("1000", 7, activity_date="2026-08-01"),
            ]
        )
        self.kiosk(
            1,
            [
                self.component("97.123456788", category="SETTLEMENT")
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
        self.settlement(
            [self.transaction("-5", category="DATA_KIOSK") | {"marketplace_name": "Amazon.ca"}]
        )
        self.kiosk(1, [self.component("0", category="SELBOX") | {"sku": None}])
        operator = self.operator()
        expected = [
            (date(2026, 6, 1), "DATA_KIOSK", "EUR", 0, -4, 4, 0, 1),
            (
                date(2026, 6, 1),
                "DATA_KIOSK",
                "USD",
                -25,
                Decimal("-15.000000001"),
                Decimal("-9.999999999"),
                2,
                2,
            ),
            (date(2026, 6, 1), "SELBOX", "USD", -3, 0, -3, 1, 1),
            (
                date(2026, 6, 1),
                "SETTLEMENT",
                "USD",
                Decimal("100.123456789"),
                Decimal("97.123456788"),
                Decimal("3.000000001"),
                2,
                1,
            ),
            (date(2026, 7, 1), "DATA_KIOSK", "USD", 0, -2, 2, 0, 1),
        ]
        self.assertEqual(self.as_user(operator, _TOTALS), expected)
        self.assertEqual(
            self.as_user(
                operator,
                "select count(*),count(*) filter(where amount=0),"
                "count(*) filter(where marketplace_name is null),"
                "count(distinct seller_namespace) from public.financial_review_records",
            ),
            [(11, 3, 2, 2)],
        )
        # Every source-specific Type sum and count rolls up to its month/category.
        self.assertEqual(
            self.as_user(
                operator,
                "select t.month,t.category::text,t.currency "
                "from unnest(array['SETTLEMENT','DATA_KIOSK','SELBOX']::"
                "public.allocation_category[]) c(k) cross join lateral "
                "public.financial_review_totals('2026-06-01','2026-08-01',c.k) t "
                "cross join lateral (select "
                "coalesce(sum(amount) filter(where source='SETTLEMENT'),0) s,"
                "coalesce(sum(amount) filter(where source='DATA_KIOSK'),0) d,"
                "coalesce(sum(row_count) filter(where source='SETTLEMENT'),0) sc,"
                "coalesce(sum(row_count) filter(where source='DATA_KIOSK'),0) dc "
                "from public.financial_review_type_totals(t.month,"
                "(t.month + interval '1 month')::date,t.category,t.currency)) a "
                "where (t.settlement_amount,t.data_kiosk_amount,t.difference,"
                "t.settlement_row_count,t.data_kiosk_row_count) is distinct from "
                "(a.s,a.d,a.s-a.d,a.sc,a.dc)",
            ),
            [],
        )
        self.connection.execute("set local timezone='Pacific/Kiritimati'")
        self.assertEqual(self.as_user(operator, _TOTALS), expected)
        self.assertEqual(
            self.as_user(
                operator,
                "select count(*) from public.financial_review_records "
                "where activity_date>='2026-07-01' and activity_date<'2026-08-01' "
                "and category='DATA_KIOSK' and currency='USD'",
            ),
            [(1,)],
        )
        self.connection.execute("set constraints all immediate")

    def test_summaries_require_explicit_valid_month_and_category_scope(self) -> None:
        query: LiteralString = "select * from public.financial_review_totals(%s,%s,%s)"
        operator = self.operator()
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
                self.as_user(operator, query, scope)
        for currency in (None, "", "usd", "USD,EUR"):
            with self.subTest(currency=currency), self.assertRaises(InvalidParameterValue):
                self.as_user(
                    operator,
                    "select * from public.financial_review_type_totals("
                    "'2026-06-01','2026-07-01','DATA_KIOSK',%s)",
                    (currency,),
                )

    def test_replacing_current_versions_does_not_count_retained_history(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
        acquisition = self.acquisition()
        _, old_settlement = self.settlement([self.transaction("100")], acquisition_id=acquisition)
        _, new_settlement = self.settlement(
            [self.transaction("50")],
            acquisition_id=acquisition,
            expected=old_settlement,
            version="v1",
        )
        _, old_kiosk = self.kiosk(1, [self.component("-10")])
        _, new_kiosk = self.kiosk(2, [self.component("-5")], expected=old_kiosk, digest="b")
        operator = self.operator()
        self.assertEqual(
            self.as_user(
                operator,
                "select source,source_version_id::text,count(*) "
                "from public.financial_review_records group by source,source_version_id "
                "order by source",
            ),
            [("DATA_KIOSK", new_kiosk, 1), ("SETTLEMENT", new_settlement, 1)],
        )
        self.assertEqual(
            self.connection.execute(
                "select (select count(*) from private.settlement_transactions),"
                "(select count(*) from private.data_kiosk_transactions)"
            ).fetchone(),
            (2, 2),
        )
        self.connection.execute("set constraints all immediate")

    def test_category_summaries_keep_zero_records_without_inventing_empty_categories(self) -> None:
        self.set_mature_cutoff_date(date(2026, 8, 1))
        self.settlement(
            [
                self.transaction("0", line, kind="ServiceFee", category="SELBOX")
                | {"sku": None, "family": None}
                for line in (3, 4)
            ]
        )
        operator = self.operator()
        for category in ("SETTLEMENT", "DATA_KIOSK"):
            self.assertEqual(
                self.as_user(
                    operator,
                    "select * from public.financial_review_totals('2026-06-01','2026-07-01',%s)",
                    (category,),
                ),
                [],
            )
        self.assertEqual(
            self.as_user(
                operator,
                "select settlement_amount,data_kiosk_amount,difference,"
                "settlement_row_count,data_kiosk_row_count "
                "from public.financial_review_totals('2026-06-01','2026-07-01','SELBOX')",
            ),
            [(0, 0, 0, 2, 0)],
        )
