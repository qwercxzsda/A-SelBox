"""Raw source projections are administrator-only; company calculation grants stay scoped."""

from decimal import Decimal

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class AdministratorSourceAccessTests(SourceModelFixture):
    def test_administrator_reads_unassigned_identity_and_all_terms_revisions(self) -> None:
        company, identity = self.owner()
        member, administrator = self.member(company), self.administrator()
        first = self.fee(identity, [("2026-01-01", None, "5")])
        second = self.fee(identity, [("2026-01-01", None, "7")])
        self.assertEqual(
            self.as_user(member, "select id::text from public.assignment_versions"), [(second,)]
        )
        self.assertEqual(
            self.as_user(
                administrator,
                "select fee_rate_percent from public.sku_fee_periods order by fee_rate_percent",
            ),
            [(Decimal(5),), (Decimal(7),)],
        )
        self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": identity,
                "sku": "SKU",
                "company_id": None,
                "expected_current_version_id": second,
                "change_reason": "Unassign current ownership",
                "periods": [],
            },
        )
        self.assertEqual(self.as_user(member, "select * from public.assignment_keys"), [])
        self.assertEqual(self.as_user(member, "select * from public.assignment_versions"), [])
        self.assertEqual(self.as_user(member, "select * from public.sku_fee_periods"), [])
        self.assertEqual(
            len(self.as_user(administrator, "select * from public.assignment_keys")), 1
        )
        self.assertEqual(
            len(self.as_user(administrator, "select * from public.assignment_versions")), 4
        )
        self.assertEqual(
            self.as_user(
                administrator,
                "select id::text from public.assignment_versions where id=%s",
                (first,),
            ),
            [(first,)],
        )
