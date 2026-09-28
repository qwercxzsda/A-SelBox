"""Current source references are shared; source facts retain current SKU ownership."""

from dataclasses import dataclass
from typing import LiteralString

import psycopg

from services.db.supabase.tests import test_live_view_equivalence as live_fixture
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id

_FACTS: LiteralString = """
select 'SETTLEMENT', id::text, version_id::text, category::text
from private.settlement_transactions
union all
select 'DATA_KIOSK', id::text, version_id::text, category::text
from private.data_kiosk_transactions
"""
_REFERENCES: LiteralString = """
select 'SETTLEMENT', 'header', id::text, current_version_id::text, null
from private.settlements
union all
select 'DATA_KIOSK', 'header', id::text, current_version_id::text, null
from private.data_kiosk_days
union all
select 'SETTLEMENT', 'version', id::text, settlement_id::text, preprocess_version::text
from private.settlement_preprocess_versions
union all
select 'DATA_KIOSK', 'version', id::text, day_id::text, preprocess_version::text
from private.data_kiosk_preprocess_versions
"""


@dataclass(frozen=True)
class SourceVersion:
    source: str
    header: str
    version: str
    facts: tuple[tuple[str, str], ...]


class SourceVersionVisibilityTests(SourceModelFixture):
    assign = live_fixture.LiveViewEquivalenceTests.assign

    def member_without_skus(self) -> str:
        company = new_id()
        self.connection.execute(
            "insert into public.companies(id,name) values (%s,'Company without SKUs')", (company,)
        )
        return self.member(company)

    def publish_pair(
        self,
        previous: tuple[SourceVersion, ...] | None = None,
        *,
        sku: str = "SKU",
        cost_only: bool = False,
        empty: bool = False,
    ) -> tuple[SourceVersion, ...]:
        settlement_rows = (
            []
            if empty
            else [
                self.transaction(
                    "10", sku=sku, category="DATA_KIOSK" if cost_only else "SETTLEMENT"
                ),
                self.transaction("20", 4, category="SELBOX") | {"family": None},
            ]
        )
        kiosk_rows = [] if empty else [self.component("-20", category="SELBOX") | {"sku": None}]
        if not (cost_only or empty):
            kiosk_rows.extend(
                [
                    self.component("-1", sku=sku),
                    self.component("2", sku=sku, category="SETTLEMENT"),
                    self.component("3", sku=sku, category="ANALYSIS_ONLY"),
                ]
            )
        settlement = self.settlement(
            settlement_rows, expected=None if previous is None else previous[0].version
        )
        kiosk = self.kiosk(
            1 if previous is None else 2,
            kiosk_rows,
            expected=None if previous is None else previous[1].version,
        )
        return tuple(
            SourceVersion(
                source,
                header,
                version,
                tuple((str(row["id"]), str(row["category"])) for row in rows),
            )
            for source, (header, version), rows in (
                ("SETTLEMENT", settlement, settlement_rows),
                ("DATA_KIOSK", kiosk, kiosk_rows),
            )
        )

    def assert_facts(
        self, user: str, owned_versions: tuple[SourceVersion, ...], *, operator: bool = False
    ) -> None:
        expected: list[tuple[object, ...]] = []
        for item in owned_versions:
            for row_id, category in item.facts:
                if (
                    operator
                    or (item.source == "SETTLEMENT" and category == "SETTLEMENT")
                    or (item.source == "DATA_KIOSK" and category != "SELBOX")
                ):
                    expected.append((item.source, row_id, item.version, category))
        self.assertCountEqual(self.as_user(user, _FACTS), expected)

    def assert_references(
        self,
        user: str,
        current: tuple[SourceVersion, ...],
        *,
        historical: tuple[SourceVersion, ...] = (),
        unselected_headers: tuple[tuple[str, str], ...] = (),
    ) -> None:
        expected: list[tuple[object, ...]] = [
            (item.source, "version", item.version, item.header, "v0")
            for item in (*current, *historical)
        ]
        expected.extend(
            (item.source, "header", item.header, item.version, None) for item in current
        )
        expected.extend(
            (source, "header", header, None, None) for source, header in unselected_headers
        )
        self.assertCountEqual(self.as_user(user, _REFERENCES), expected)

    def assert_member(self, user: str, expected: bool) -> None:
        self.assertEqual(self.as_user(user, "select private.is_company_member()"), [(expected,)])

    def test_members_share_all_current_references_while_facts_remain_owned(self) -> None:
        company, _ = self.owner()
        old = self.publish_pair()
        current = self.publish_pair(old)
        self.seller = "other-seller"
        other_company, _ = self.owner("OTHER")
        other = self.publish_pair(sku="OTHER")
        self.seller = "cost-only-seller"
        cost_only = self.publish_pair(cost_only=True)
        self.seller = "empty-seller"
        empty = self.publish_pair(empty=True)
        all_current = (*current, *other, *cost_only, *empty)

        for user, owned in (
            (self.member(company), (*current, *cost_only)),
            (self.member(other_company), other),
            (self.member_without_skus(), ()),
        ):
            self.assert_member(user, True)
            self.assert_references(user, all_current)
            self.assert_facts(user, owned)
        operator = self.operator()
        self.assert_member(operator, False)
        self.assert_references(operator, all_current, historical=old)
        self.assert_facts(operator, (*all_current, *old), operator=True)
        for user in (self.auth_user(), ""):
            self.assert_member(user, False)
            self.assert_references(user, ())
            self.assert_facts(user, ())
        self.connection.execute("set constraints all immediate")

    def test_ownership_changes_preserve_references_and_account_revocation_denies_both(self) -> None:
        company_a, sku = self.owner()
        company_b, _ = self.owner("OTHER")
        terms = self.fee(sku, [])
        current = self.publish_pair()
        member_a, member_b = self.member(company_a), self.member(company_b)
        for user in (member_a, member_b):
            self.assert_references(user, current)
        self.assert_facts(member_a, current)
        self.assert_facts(member_b, ())

        revised = self.assign("SKU", company_b, expected=terms)
        for user in (member_a, member_b):
            self.assert_references(user, current)
        self.assert_facts(member_a, ())
        self.assert_facts(member_b, current)
        self.connection.execute(
            "update public.app_accounts set company_id=%s where user_id=%s", (company_b, member_a)
        )
        self.assert_references(member_a, current)
        self.assert_facts(member_a, current)
        self.connection.execute("delete from public.app_accounts where user_id=%s", (member_a,))
        self.assert_member(member_a, False)
        self.assert_references(member_a, ())
        self.assert_facts(member_a, ())
        self.assign("SKU", None, expected=revised)
        self.assert_member(member_b, True)
        self.assert_references(member_b, current)
        self.assert_facts(member_b, ())
        self.connection.execute("set constraints all immediate")

    def test_publication_replaces_visible_references_and_null_pointers_stay_hidden(self) -> None:
        company, _ = self.owner()
        member, operator = self.member(company), self.operator()
        old = self.publish_pair()
        self.assert_references(member, old)
        self.assert_facts(member, old)
        current = self.publish_pair(old, empty=True)
        self.assert_references(member, current)
        self.assert_facts(member, ())
        self.assert_references(operator, current, historical=old)
        self.assert_facts(operator, old, operator=True)

        with self.connection.transaction(force_rollback=True):
            settlement, day = new_id(), new_id()
            self.connection.execute(
                "insert into private.settlements "
                "(id,seller_namespace,amazon_scope,settlement_id,document_sha256) "
                "values (%s,'unselected-seller','NA','unselected',%s)",
                (settlement, "f" * 64),
            )
            self.connection.execute(
                "insert into private.data_kiosk_days "
                "(id,seller_namespace,marketplace_name,activity_date,dataset_key) "
                "values (%s,'unselected-seller','Amazon.com','2026-06-15','economics')",
                (day,),
            )
            self.assert_references(member, current)
            self.assert_references(
                operator,
                current,
                historical=old,
                unselected_headers=(("SETTLEMENT", settlement), ("DATA_KIOSK", day)),
            )
        self.connection.execute("set constraints all immediate")

    def test_reference_columns_member_gate_and_full_metadata_remain_restricted(self) -> None:
        company, _ = self.owner()
        current = self.publish_pair()
        member, no_skus, operator = (
            self.member(company),
            self.member_without_skus(),
            self.operator(),
        )
        for user in (member, no_skus, operator):
            for statement in (
                "select seller_namespace from private.settlements",
                "select seller_namespace from private.data_kiosk_days",
                "select total_amount from private.settlement_preprocess_versions",
                "select row_count from private.settlement_preprocess_versions",
                "select row_count from private.data_kiosk_preprocess_versions",
                "select content_sha256 from private.data_kiosk_preprocess_versions",
            ):
                with (
                    self.subTest(user=user, statement=statement),
                    self.assertRaises(psycopg.errors.InsufficientPrivilege),
                ):
                    self.as_user(user, statement)
        for statement in (
            "select * from public.settlement_preprocess_results",
            "select * from public.data_kiosk_preprocess_results",
        ):
            for user in (member, no_skus, self.auth_user()):
                with (
                    self.subTest(user=user, statement=statement),
                    self.assertRaises(psycopg.errors.InsufficientPrivilege),
                ):
                    self.as_user(user, statement)
            self.assertEqual(len(self.as_user(operator, statement)), 1)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute(_REFERENCES)
        self.assertEqual(
            self.connection.execute(
                "select p.prosecdef,p.provolatile::text,p.proleakproof,"
                "p.proconfig @> array['search_path=\"\"'],"
                "has_function_privilege('authenticated',p.oid,'EXECUTE'),"
                "has_function_privilege('anon',p.oid,'EXECUTE'),"
                "has_function_privilege('service_role',p.oid,'EXECUTE'),"
                "exists(select 1 from "
                "aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
                "where a.grantee=0 and a.privilege_type='EXECUTE') "
                "from pg_proc p where p.oid='private.is_company_member()'::regprocedure"
            ).fetchone(),
            (True, "s", False, True, True, False, False, False),
        )
        self.assert_references(no_skus, current)
