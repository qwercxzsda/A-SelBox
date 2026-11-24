"""Bulk publications retain exact, immutable inventories and source controls."""

import psycopg

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class PublicationInventoryTests(SourceModelFixture):
    def test_partial_inventory_fails_but_complete_multi_statement_insert_succeeds(self) -> None:
        _, owner = self.owner()
        version = self.fee(owner, [])
        self.connection.commit()
        next_version = new_id()
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self._fee_header(next_version, owner)
            self._fee_period(next_version, "[2026-01-01,2026-07-01)")
            self.connection.execute("set constraints all immediate")
        self._fee_header(next_version, owner)
        self._fee_period(next_version, "[2026-01-01,2026-07-01)")
        self._fee_period(next_version, "[2026-07-01,2027-01-01)")
        self.connection.commit()
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.sku_fee_periods where assignment_version_id=%s",
                (next_version,),
            ).fetchone(),
            (2,),
        )
        for frozen_version in (version, next_version):
            with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
                self._fee_period(frozen_version, "[2030-01-01,2031-01-01)")

    def _fee_header(self, version: str, owner: str) -> None:
        self.connection.execute(
            "insert into public.assignment_versions "
            "(id,key_id,kind,origin,company_id,version_number,fee_period_count,memo) "
            "select %s,s.id,'SKU','ADMINISTRATOR',v.company_id,v.version_number+1,2,'Complete "
            "inventory check' "
            "from public.assignment_keys s join public.assignment_versions v "
            "on v.id=s.current_version_id where s.id=%s",
            (version, owner),
        )

    def _fee_period(self, version: str, period: str) -> None:
        self.connection.execute(
            "insert into public.sku_fee_periods "
            "(assignment_version_id,marketplace_name,valid_period,fee_rate_percent) "
            "values (%s,'Amazon.com',%s::daterange,5)",
            (version, period),
        )
