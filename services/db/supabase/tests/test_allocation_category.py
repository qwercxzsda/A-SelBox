"""One named category controls allocation and intentionally excluded analysis."""

from decimal import Decimal

import psycopg
from psycopg import sql

from services.db.supabase.tests.source_fixtures import SourceModelFixture


class AllocationCategoryTests(SourceModelFixture):
    def test_analysis_category_does_not_affect_authoritative_totals(self) -> None:
        self.owner()
        recent = self.current_activity_date()
        self.kiosk(
            1,
            [
                self.component("-10"),
                self.component("100", category="FINANCES"),
                self.component("-90", category="ANALYSIS_ONLY"),
                self.component("-80", category="SELBOX") | {"sku": None},
            ],
            activity_date=recent,
        )
        self.assertEqual(
            self.connection.execute(
                "select category,authoritative "
                "from public.live_company_components order by category"
            ).fetchall(),
            [
                ("DATA_KIOSK", True),
            ],
        )
        self.assertEqual(
            self.connection.execute(
                "select category,source_amount from public.live_company_components "
                "where source='DATA_KIOSK' and authoritative order by category"
            ).fetchall(),
            [
                ("DATA_KIOSK", Decimal("-10")),
            ],
        )
        query = (
            "select source_amount,fee_amount,company_amount from "
            "private.company_financial_totals(%s,%s,%s,"
            "'v0','{}',array['Amazon.com']::text[])"
        )
        self.assertEqual(
            self.connection.execute(query, (self.seller, recent, recent)).fetchall(),
            [(Decimal("-10"), Decimal(0), Decimal("-10"))],
        )

    def test_publication_rejects_missing_category_atomically(self) -> None:
        for source in ("FINANCES", "DATA_KIOSK"):
            row = self.transaction("-1") if source == "FINANCES" else self.component()
            row.pop("category")
            with (
                self.subTest(source=source),
                self.assertRaises(
                    ValueError if source == "FINANCES" else psycopg.errors.CheckViolation
                ),
                self.connection.transaction(),
            ):
                if source == "FINANCES":
                    self.finances([row])
                else:
                    self.kiosk(1, [row])
        for table in (
            "finances_preprocess_batches",
            "data_kiosk_preprocess_batches",
            "data_kiosk_day_versions",
        ):
            self.assertEqual(
                self.connection.execute(
                    sql.SQL("select count(*) from private.{}").format(sql.Identifier(table))
                ).fetchone(),
                (0,),
            )

    def test_finances_cannot_use_the_analysis_category(self) -> None:
        with self.assertRaises(ValueError), self.connection.transaction():
            self.finances([self.transaction("-1", category="ANALYSIS_ONLY")])

    def test_no_category_can_be_null(self) -> None:
        for source in ("FINANCES", "DATA_KIOSK"):
            with (
                self.subTest(source=source),
                self.assertRaises(
                    ValueError if source == "FINANCES" else psycopg.errors.NotNullViolation
                ),
                self.connection.transaction(),
            ):
                if source == "FINANCES":
                    self.finances([self.transaction("-1") | {"category": None}])
                else:
                    self.kiosk(1, [self.component() | {"category": None}])

    def test_unknown_and_numeric_categories_cannot_enter_source_tables(self) -> None:
        for category in ("UNKNOWN", "1"):
            with (
                self.subTest(source="FINANCES", category=category),
                self.assertRaises(ValueError),
                self.connection.transaction(),
            ):
                self.finances([self.transaction("-1", category=category)])
            with (
                self.subTest(source="DATA_KIOSK", category=category),
                self.assertRaises(psycopg.errors.InvalidTextRepresentation),
                self.connection.transaction(),
            ):
                self.kiosk(1, [self.component(category=category)])
