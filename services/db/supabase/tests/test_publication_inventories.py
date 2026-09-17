"""Bulk publications retain exact, immutable inventories and source controls."""

from decimal import Decimal

import psycopg

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class PublicationInventoryTests(SourceModelFixture):
    def test_bulk_sources_publish_exact_complete_sets(self) -> None:
        # Representative payload sizes exercise the actual publication functions.
        # Exact results are asserted; machine-specific timing belongs in benchmarks.
        self.connection.execute("set statement_timeout='20s'")
        for count in (1000, 4000):
            _, version = self.settlement(
                [self.transaction("1", index + 3) for index in range(count)],
                identity=f"settlement-{count}",
            )
            self.assertEqual(
                self.connection.execute(
                    "select count(*),sum(amount),min(source_line_number),max(source_line_number) "
                    "from private.settlement_transactions where version_id=%s",
                    (version,),
                ).fetchone(),
                (count, Decimal(count), 3, count + 2),
            )
        _, day_version = self.kiosk(1, [self.component() for _ in range(4000)])
        self.assertEqual(
            self.connection.execute(
                "select count(*),sum(amount) from private.data_kiosk_transactions "
                "where version_id=%s",
                (day_version,),
            ).fetchone(),
            (4000, Decimal(-40000)),
        )
        self.connection.execute("set constraints all immediate")

    def test_published_inventories_reject_additional_children(self) -> None:
        _, owner = self.owner()
        fee = self.fee(owner, [("2026-01-01", "2027-01-01", "5")])
        _, settlement = self.settlement([self.transaction("1")])
        _, kiosk = self.kiosk(1, [self.component()])
        self.connection.commit()
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "insert into public.sku_fee_periods "
                "(terms_version_id,marketplace_name,valid_period,fee_rate_percent) "
                "values (%s,'Amazon.com','[2030-01-01,)',5)",
                (fee,),
            )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "insert into private.settlement_transactions select "
                "(jsonb_populate_record(null::private.settlement_transactions, "
                "to_jsonb(t)||jsonb_build_object('id',%s::text,'source_line_number',999))).* "
                "from private.settlement_transactions t where version_id=%s",
                (new_id(), settlement),
            )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "insert into private.data_kiosk_transactions select "
                "(jsonb_populate_record(null::private.data_kiosk_transactions, "
                "to_jsonb(t)||jsonb_build_object('id',%s::text,'component_key','additional'))).* "
                "from private.data_kiosk_transactions t where version_id=%s",
                (new_id(), kiosk),
            )

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
                "select count(*) from public.sku_fee_periods where terms_version_id=%s",
                (next_version,),
            ).fetchone(),
            (2,),
        )
        for frozen_version in (version, next_version):
            with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
                self._fee_period(frozen_version, "[2030-01-01,2031-01-01)")

    def test_pruned_inventory_cannot_be_refilled(self) -> None:
        versions: list[str] = []
        for observation in range(1, 5):
            _, version = self.kiosk(
                observation,
                [self.component()],
                expected=versions[-1] if versions else None,
            )
            versions.append(version)
        self.connection.commit()
        self.connection.execute("select private.prune_data_kiosk_preprocess()")
        self.connection.commit()
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "insert into private.data_kiosk_transactions select "
                "(jsonb_populate_record(null::private.data_kiosk_transactions, "
                "to_jsonb(t)||jsonb_build_object('id',%s::text,'version_id',%s::text))).* "
                "from private.data_kiosk_transactions t where version_id=%s",
                (new_id(), versions[0], versions[-1]),
            )

    def test_invalid_bulk_source_controls_roll_back_whole_publication(self) -> None:
        mismatched_currency = self.transaction("1", 4) | {"currency": "CAD"}
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.settlement([self.transaction("1"), mismatched_currency])
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.settlement_preprocess_versions"
            ).fetchone(),
            (0,),
        )
        invalid_component = self.component() | {"amount": "NaN"}
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.kiosk(1, [self.component(), invalid_component])
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_preprocess_batches"
            ).fetchone(),
            (0,),
        )

    def _fee_header(self, version: str, owner: str) -> None:
        self.connection.execute(
            "insert into public.sku_terms_versions "
            "(id,seller_sku_id,company_id,version_number,fee_period_count,change_reason) "
            "select %s,s.id,v.company_id,v.version_number+1,2,'Complete inventory check' "
            "from public.seller_skus s join public.sku_terms_versions v "
            "on v.id=s.current_terms_version_id where s.id=%s",
            (version, owner),
        )

    def _fee_period(self, version: str, period: str) -> None:
        self.connection.execute(
            "insert into public.sku_fee_periods "
            "(terms_version_id,marketplace_name,valid_period,fee_rate_percent) "
            "values (%s,'Amazon.com',%s::daterange,5)",
            (version, period),
        )
