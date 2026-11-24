"""Keep SQL categories and source vocabulary aligned with the preprocessors."""

import psycopg

from services.db.supabase.tests.source_fixtures import SourceModelFixture


class SchemaContractTests(SourceModelFixture):
    def test_finances_routing_vocabulary(self) -> None:
        routes = self.connection.execute(
            "select unnest(enum_range(null::private.finances_route))::text"
        ).fetchall()
        self.assertEqual(
            {r[0] for r in routes},
            {
                "SKU",
                "FNSKU",
                "ASIN",
                "PROMOTION",
                "SHIPMENT",
                "CUSTOMER_ORDER",
                "AD_INVOICE",
                "STORAGE",
                "AGED_STORAGE",
                "REMOVAL_ORDER",
                "SELBOX",
            },
        )

    def test_default_finances_account_retains_sku_without_company_access(self) -> None:
        source_sku = " SKU "
        company, _ = self.owner(source_sku)
        self.finances(
            [
                self.transaction("-11", sku=source_sku, route="SELBOX", kind="ServiceFee")
                | {
                    "component_type": "SUBSCRIPTION_FEES",
                    "breakdown_path": ["Subscription", "Base"],
                }
            ]
        )
        self.assertEqual(
            self.connection.execute("select route,sku from private.finances_amounts").fetchone(),
            ("SELBOX", source_sku),
        )
        self.assertEqual(
            self.connection.execute(
                "select sku,company_id,source_amount,company_amount,fee_amount "
                "from public.live_company_components"
            ).fetchone(),
            (source_sku, None, -11, 0, 0),
        )
        user = self.member(company)
        self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
        self.connection.execute("set local role authenticated")
        self.assertEqual(
            self.connection.execute("select count(*) from private.finances_amounts").fetchone(),
            (0,),
        )
        self.connection.execute("reset role")

    def test_allocated_finances_transaction_components_require_a_source_sku(self) -> None:
        with (
            self.assertRaises((ValueError, psycopg.errors.CheckViolation)),
            self.connection.transaction(),
        ):
            self.finances([self.transaction("100") | {"sku": None}])
        self.assertEqual(
            self.connection.execute("select count(*) from private.finances_amounts").fetchone(),
            (0,),
        )
