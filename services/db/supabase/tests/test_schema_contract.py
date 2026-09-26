"""Keep SQL categories and source vocabulary aligned with the preprocessors."""

import psycopg

from services.db.supabase.tests.source_fixtures import SourceModelFixture
from services.sync.src.allocation import AllocationCategory


class SchemaContractTests(SourceModelFixture):
    def test_allocation_enum_matches_the_shared_python_categories(self) -> None:
        categories = self.connection.execute(
            "select unnest(enum_range(null::public.allocation_category))::text"
        ).fetchall()
        self.assertEqual(
            tuple(row[0] for row in categories),
            tuple(category.value for category in AllocationCategory),
        )

    def test_default_settlement_account_retains_sku_without_company_access(self) -> None:
        source_sku = " SKU "
        company, _ = self.owner(source_sku)
        self.settlement(
            [
                self.transaction("-11", sku=source_sku, category="SELBOX", kind="NewFee")
                | {
                    "family": None,
                    "component_type": "UNMATCHED",
                    "source_fields": {"sku": source_sku},
                }
            ]
        )
        self.assertEqual(
            self.connection.execute(
                "select category,family,sku,source_fields->>'sku' "
                "from private.settlement_transactions"
            ).fetchone(),
            ("SELBOX", None, source_sku, source_sku),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.live_company_components"
            ).fetchone(),
            (0,),
        )
        user = self.member(company)
        self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
        self.connection.execute("set local role authenticated")
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.settlement_transactions"
            ).fetchone(),
            (0,),
        )
        self.connection.execute("reset role")

    def test_known_settlement_account_families_reject_a_source_sku(self) -> None:
        for family in ("F5", "F6", "F7"):
            with (
                self.subTest(family=family),
                self.assertRaises(psycopg.errors.CheckViolation) as raised,
                self.connection.transaction(),
            ):
                self.settlement(
                    [
                        self.transaction("-1", category="SELBOX", kind="AccountFee")
                        | {"family": family}
                    ]
                )
            self.assertEqual(
                raised.exception.diag.constraint_name,
                "settlement_account_family_requires_blank_sku",
            )

    def test_data_kiosk_publication_rejects_account_category_with_sku(self) -> None:
        with (
            self.assertRaises(psycopg.errors.CheckViolation) as raised,
            self.connection.transaction(),
        ):
            self.kiosk(
                1,
                [self.component(category="SELBOX") | {"component_type": "SubscriptionFee"}],
            )
        self.assertEqual(
            raised.exception.diag.constraint_name, "data_kiosk_account_requires_blank_sku"
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_transactions"
            ).fetchone(),
            (0,),
        )

    def test_direct_data_kiosk_insert_cannot_bypass_account_sku_guard(self) -> None:
        _, version = self.kiosk(1, [])
        with (
            self.assertRaises(psycopg.errors.CheckViolation) as raised,
            self.connection.transaction(),
        ):
            self.connection.execute(
                "insert into private.data_kiosk_transactions "
                "(version_id,seller_namespace,marketplace_name,activity_date,component_key,sku,"
                "category,component_type,amount,currency,"
                "native_dimensions,source_line_number) "
                "values (%s,%s,'Amazon.com','2026-06-15','direct','SKU','SELBOX',"
                "'SubscriptionFee',-10,'USD','{}',1)",
                (version, self.seller),
            )
        self.assertEqual(
            raised.exception.diag.constraint_name, "data_kiosk_account_requires_blank_sku"
        )
