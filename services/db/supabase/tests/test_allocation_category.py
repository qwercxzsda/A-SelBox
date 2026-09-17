"""One named category controls allocation and intentionally excluded analysis."""

from decimal import Decimal

import psycopg
from psycopg import sql

from services.db.supabase.tests.source_fixtures import SourceModelFixture


class AllocationCategoryTests(SourceModelFixture):
    def test_analysis_category_does_not_affect_authoritative_totals(self) -> None:
        self.owner()
        self.kiosk(
            1,
            [
                self.component("-10"),
                self.component("100", category="SETTLEMENT"),
                self.component("-90", category="ANALYSIS_ONLY"),
                self.component("-80", category="SELBOX") | {"sku": None},
            ],
        )
        self.assertEqual(
            self.connection.execute(
                "select category,authoritative "
                "from public.live_company_components order by category"
            ).fetchall(),
            [
                ("SETTLEMENT", False),
                ("SELBOX", False),
                ("DATA_KIOSK", True),
                ("ANALYSIS_ONLY", False),
            ],
        )
        self.assertEqual(
            self.connection.execute(
                "select category,amount from public.data_kiosk_others_entries"
            ).fetchall(),
            [("DATA_KIOSK", Decimal("-10"))],
        )
        query = (
            "select source_amount,fee_amount,company_amount from "
            "private.company_financial_totals(%s,'2026-06-15','2026-06-15',"
            "'v0','{}',array['Amazon.com']::public.amazon_marketplace_name[])"
        )
        self.assertEqual(
            self.connection.execute(query, (self.seller,)).fetchall(),
            [(Decimal("-10"), Decimal(0), Decimal("-10"))],
        )

    def test_publication_rejects_missing_category_atomically(self) -> None:
        for source in ("SETTLEMENT", "DATA_KIOSK"):
            row = self.transaction("-1") if source == "SETTLEMENT" else self.component()
            row.pop("category")
            with (
                self.subTest(source=source),
                self.assertRaisesRegex(psycopg.errors.CheckViolation, "require category"),
                self.connection.transaction(),
            ):
                if source == "SETTLEMENT":
                    self.settlement([row])
                else:
                    self.kiosk(1, [row])
        for table in (
            "settlement_preprocess_versions",
            "data_kiosk_preprocess_batches",
            "data_kiosk_preprocess_versions",
        ):
            self.assertEqual(
                self.connection.execute(
                    sql.SQL("select count(*) from private.{}").format(sql.Identifier(table))
                ).fetchone(),
                (0,),
            )

    def test_settlement_cannot_use_the_analysis_category(self) -> None:
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.settlement([self.transaction("-1", category="ANALYSIS_ONLY")])

    def test_no_category_can_be_null(self) -> None:
        for source in ("SETTLEMENT", "DATA_KIOSK"):
            with (
                self.subTest(source=source),
                self.assertRaises(psycopg.errors.NotNullViolation),
                self.connection.transaction(),
            ):
                if source == "SETTLEMENT":
                    self.settlement([self.transaction("-1") | {"category": None}])
                else:
                    self.kiosk(1, [self.component() | {"category": None}])

    def test_unknown_and_numeric_categories_cannot_enter_source_tables(self) -> None:
        for category in ("UNKNOWN", "1"):
            with (
                self.subTest(source="SETTLEMENT", category=category),
                self.assertRaises(psycopg.errors.InvalidTextRepresentation),
                self.connection.transaction(),
            ):
                self.settlement([self.transaction("-1", category=category)])
            with (
                self.subTest(source="DATA_KIOSK", category=category),
                self.assertRaises(psycopg.errors.InvalidTextRepresentation),
                self.connection.transaction(),
            ):
                self.kiosk(1, [self.component(category=category)])
