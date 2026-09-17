"""The public operator endpoint preserves atomic complete terms and stale-write checks."""

from decimal import Decimal
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from services.db.supabase.tests.source_fixtures import SourceModelFixture

_PUBLISH = "select public.publish_sku_terms(%s,%s,%s,%s,%s,%s)::text"


class OperatorTermsPublicationTests(SourceModelFixture):
    def publish(
        self,
        user: str,
        company: str | None,
        expected: str | None,
        periods: object,
    ) -> str:
        rows = self.as_user(
            user,
            _PUBLISH,
            (self.seller, " API SKU ", company, expected, "Complete terms", Jsonb(periods)),
        )
        return str(rows[0][0])

    @staticmethod
    def period(marketplace: str = "Amazon.com", rate: str = "5") -> dict[str, object]:
        return {
            "marketplace_name": marketplace,
            "valid_from": "2026-01-01",
            "valid_to": None,
            "fee_rate_percent": rate,
        }

    def test_public_wrapper_requires_an_operator_before_publication(self) -> None:
        company, _ = self.owner()
        user = self.auth_user()
        for denied in (self.member(company), user):
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.publish(denied, company, None, [])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute(
                _PUBLISH, (self.seller, " API SKU ", company, None, "Denied", Jsonb([]))
            )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.seller_skus where sku=' API SKU '"
            ).fetchone(),
            (0,),
        )

    def test_public_wrapper_generates_ids_and_replaces_the_entire_inventory(self) -> None:
        company, _ = self.owner()
        operator = self.operator()
        first = self.publish(
            operator, company, None, [self.period(), self.period("Amazon.ca", "6")]
        )
        self.assertEqual(UUID(first).version, 7)
        self.assertEqual(
            self.as_user(
                operator,
                "select s.sku,v.version_number,v.fee_period_count from public.seller_skus s "
                "join public.sku_terms_versions v on v.id=s.current_terms_version_id "
                "where s.sku=' API SKU '",
            ),
            [(" API SKU ", 1, 2)],
        )
        second = self.publish(operator, company, first, [self.period(rate="7")])
        self.assertEqual(
            self.as_user(
                operator,
                "select p.marketplace_name,p.fee_rate_percent "
                "from public.current_sku_fee_periods p "
                "join public.seller_skus s on s.id=p.seller_sku_id where s.sku=' API SKU '",
            ),
            [("Amazon.com", Decimal(7))],
        )
        self.assertEqual(
            self.as_user(
                operator,
                "select count(*) from public.sku_fee_periods where terms_version_id=%s",
                (first,),
            ),
            [(2,)],
        )
        third = self.publish(operator, None, second, [])
        self.assertEqual(
            self.as_user(
                operator,
                "select s.current_terms_version_id::text,v.company_id,v.fee_period_count "
                "from public.seller_skus s join public.sku_terms_versions v "
                "on v.id=s.current_terms_version_id where s.sku=' API SKU '",
            ),
            [(third, None, 0)],
        )
        self.connection.execute("set constraints all immediate")

    def test_stale_or_invalid_publication_leaves_the_selected_inventory_unchanged(self) -> None:
        company, _ = self.owner()
        operator = self.operator()
        first = self.publish(operator, company, None, [self.period()])
        selected = self.publish(operator, company, first, [self.period(rate="7")])
        with self.assertRaises(psycopg.errors.SerializationFailure):
            self.publish(operator, company, first, [])
        invalid_inventories: tuple[object, ...] = (
            None,
            {},
            [None],
            [self.period(), self.period()],
            [self.period(rate="5.0000000")],
        )
        for inventory in invalid_inventories:
            with self.subTest(inventory=inventory), self.assertRaises(psycopg.Error):
                self.publish(operator, company, selected, inventory)
        self.assertEqual(
            self.connection.execute(
                "select s.current_terms_version_id::text,count(v.id) from public.seller_skus s "
                "join public.sku_terms_versions v on v.seller_sku_id=s.id "
                "where s.sku=' API SKU ' group by s.current_terms_version_id"
            ).fetchone(),
            (selected, 2),
        )
        self.assertEqual(
            self.connection.execute(
                "select fee_rate_percent from public.sku_fee_periods where terms_version_id=%s",
                (selected,),
            ).fetchall(),
            [(Decimal(7),)],
        )
        self.connection.execute("set constraints all immediate")
