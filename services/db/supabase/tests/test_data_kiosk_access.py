"""Company members read current source facts under current seller/SKU ownership."""

from decimal import Decimal

import psycopg

from services.db.supabase.tests.source_fixtures import SourceModelFixture


class DataKioskAccessTests(SourceModelFixture):
    def test_company_reads_do_not_cross_sellers_or_include_account_components(self) -> None:
        company, _ = self.owner()
        self.owner("OTHER")
        self.owner(seller="seller-two")
        _, previous = self.kiosk(1, [self.component("-1")])
        self.kiosk(
            2,
            [
                self.component("-3"),
                self.component("100", category="SETTLEMENT"),
                self.component("-6", category="ANALYSIS_ONLY"),
                self.component("-8", sku="OTHER"),
                self.component("-9", category="SELBOX") | {"sku": None},
            ],
            expected=previous,
        )
        self.seller = "seller-two"
        self.kiosk(1, [self.component("-50")])
        user = self.member(company)
        self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
        self.connection.execute("set local role authenticated")

        self.assertEqual(
            self.connection.execute(
                "select seller_namespace,sku,amount from private.data_kiosk_transactions "
                "order by amount"
            ).fetchall(),
            [
                ("seller-one", "SKU", Decimal("-6")),
                ("seller-one", "SKU", Decimal("-3")),
                ("seller-one", "SKU", Decimal("100")),
            ],
        )
        self.assertEqual(
            self.connection.execute(
                "select amount from public.data_kiosk_preprocess_entries "
                "where category='SETTLEMENT'"
            ).fetchall(),
            [(Decimal("100"),)],
        )
        self.assertEqual(
            self.connection.execute(
                "select amount from public.data_kiosk_preprocess_entries "
                "where category='DATA_KIOSK'"
            ).fetchall(),
            [(Decimal("-3"),)],
        )
        self.assertEqual(
            self.connection.execute(
                "select source_amount,authoritative from public.live_company_components "
                "order by source_amount"
            ).fetchall(),
            [
                (Decimal("-6"), False),
                (Decimal("-3"), True),
                (Decimal("100"), False),
            ],
        )
        for statement in (
            "select * from private.data_kiosk_acquisitions",
            "select * from private.data_kiosk_preprocess_batches",
            "select row_count from private.data_kiosk_preprocess_versions",
            "select seller_namespace from private.data_kiosk_days",
            "select private.prune_data_kiosk_preprocess()",
            "delete from private.data_kiosk_transactions",
        ):
            with (
                self.subTest(statement=statement),
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute(statement)
        self.assertEqual(
            self.connection.execute(
                "select * from public.data_kiosk_preprocess_entries where category='SELBOX'"
            ).fetchall(),
            [],
        )

        # Account revocation takes effect without replacing the user's JWT.
        self.connection.execute("reset role")
        self.connection.execute("delete from public.app_accounts where user_id=%s", (user,))
        self.connection.execute("set local role authenticated")
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.live_company_components"
            ).fetchone(),
            (0,),
        )
        self.connection.execute("reset role")
        self.connection.execute("set constraints all immediate")
