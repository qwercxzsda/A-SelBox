"""Who reads which campaign, promotion and shipment assignments, and their marketplaces."""

from typing import LiteralString, cast

import psycopg

from services.db.supabase.tests.reference_fixture import ReferenceFixture

_READ: LiteralString = "select public.reference_assignments()"
_PREPARE_OWNED: LiteralString = """
prepare owned_assignments as select
    (select coalesce(jsonb_agg(k.native_id order by k.native_id collate "C"), '[]')
        from private.current_owned_assignments() as o
        join public.assignment_keys as k on k.id = o.key_id),
    (select count(*) from public.assignment_versions)
"""
_PREPARE_LISTED: LiteralString = """
prepare listed_assignments as
select jsonb_path_query_array(public.reference_assignments(), '$.items[*].native_key')
"""
_MEMBER_KEYS = {
    "kind",
    "seller_namespace",
    "amazon_scope",
    "native_key",
    "marketplace_names",
    "company_id",
    "key_id",
    "current_version_id",
}
_REVIEW_KEYS = {"assignment_origin", "warning", "suggested_company_id", "products"}


class ReferenceAssignmentTests(ReferenceFixture):
    def setUp(self) -> None:
        super().setUp()
        self.company, self.other = str(self.company), str(self.other)
        self.assign_sku("A", self.company)
        self.assign_sku("B", self.other)
        self.finance(
            [
                {"route": "PROMOTION", "key": "promo", "amount": -1, "marketplace": "Amazon.ca"},
                {"route": "SHIPMENT", "key": "ship", "amount": -2},
                {"route": "SHIPMENT", "key": "ship", "amount": -3, "marketplace": "Amazon.com.mx"},
                {"route": "SHIPMENT", "key": "theirs", "amount": -4},
                {"route": "PROMOTION", "key": "spare", "amount": -5},
                {"route": "AD_INVOICE", "key": "invoice", "amount": -5},
            ]
        )
        self.reference(
            "AD_INVOICE",
            "invoice",
            [
                {
                    "base_amount": "4",
                    "cost_amount": "4",
                    "ad_program": "SPONSORED_PRODUCTS",
                    "tax_amount": "0",
                    "line_kind": "CAMPAIGN",
                    "campaign_id": "ad",
                },
                {
                    "base_amount": "1",
                    "cost_amount": "1",
                    "tax_amount": "0",
                    "line_kind": "ACCOUNT_ADJUSTMENT",
                    "adjustment_kind": "ROUNDING",
                },
            ],
        )
        self.reference("CAMPAIGN", "ad", [{"sku": "A"}])
        # Campaign and promotion marketplaces come from Amazon's record, never from charges.
        self.reference("CAMPAIGN", "idle", [], marketplace="Amazon.ca")
        # The other company's product: the default assigns it there, an administrator moves it.
        self.reference("PROMOTION", "promo", [{"sku": "B"}], marketplace="Amazon.ca")
        self.reference("PROMOTION", "quiet", [{"sku": "A"}], marketplace="Amazon.com.mx")
        self.reference("SHIPMENT", "ship", [{"sku": "A"}])
        self.reference("SHIPMENT", "theirs", [{"sku": "B"}])
        self.assertEqual(self.one("select private.default_reference_assignments()"), 5)
        self.administrator = self.account("administrator")
        self.member = self.account("member", self.company)
        self.other_member = self.account("member", self.other)
        self.earlier_promo = self.current_version("promo")
        self.as_user(
            self.administrator,
            "select public.set_reference_assignment(%s,'NA','PROMOTION','promo',%s,%s,%s)",
            (self.seller, self.company, self.earlier_promo, "Bundled with company A"),
        )

    def current_version(self, native_key: str) -> str:
        return str(
            self.one(
                "select current_version_id from public.assignment_keys where native_id=%s",
                (native_key,),
            )
        )

    def key(self, native_key: str) -> str:
        return str(
            self.one("select id from public.assignment_keys where native_id=%s", (native_key,))
        )

    def items(self, user: str) -> list[dict[str, object]]:
        result = cast(dict[str, list[dict[str, object]]], self.as_user(user, _READ)[0][0])
        self.assertEqual(set(result), {"items"})
        return result["items"]

    def member_item(
        self, kind: str, native_key: str, company: str, marketplaces: list[str]
    ) -> dict[str, object]:
        return {
            "kind": kind,
            "seller_namespace": self.seller,
            "amazon_scope": "NA",
            "native_key": native_key,
            "marketplace_names": marketplaces,
            "company_id": company,
            "key_id": self.key(native_key),
            "current_version_id": self.current_version(native_key),
        }

    def test_member_reads_only_their_company_current_assignments_of_every_kind(self) -> None:
        self.assertEqual(
            self.items(self.member),
            [
                self.member_item("CAMPAIGN", "ad", self.company, ["Amazon.com"]),
                self.member_item("PROMOTION", "promo", self.company, ["Amazon.ca"]),
                self.member_item("PROMOTION", "quiet", self.company, ["Amazon.com.mx"]),
                self.member_item("SHIPMENT", "ship", self.company, ["Amazon.com", "Amazon.com.mx"]),
            ],
        )
        # The other company's earlier promotion version stays administrator-only.
        self.assertEqual(
            self.items(self.other_member),
            [self.member_item("SHIPMENT", "theirs", self.other, ["Amazon.com"])],
        )

    def test_member_items_never_carry_products_suggestions_or_warnings(self) -> None:
        promo = next(
            item for item in self.items(self.administrator) if item["native_key"] == "promo"
        )
        self.assertEqual(promo["warning"], "PRODUCTS_DISAGREE")
        self.assertEqual(promo["suggested_company_id"], self.other)
        for user in (self.member, self.other_member):
            for item in self.items(user):
                self.assertEqual(set(item), _MEMBER_KEYS)
                self.assertNotIn(self.other if user == self.member else self.company, str(item))

    def test_administrator_reads_every_known_id_with_review_fields(self) -> None:
        items = self.items(self.administrator)
        self.assertEqual(
            [(item["native_key"], item["kind"]) for item in items],
            [
                ("ad", "CAMPAIGN"),
                ("idle", "CAMPAIGN"),
                ("promo", "PROMOTION"),
                ("quiet", "PROMOTION"),
                ("ship", "SHIPMENT"),
                ("spare", "PROMOTION"),
                ("theirs", "SHIPMENT"),
            ],
        )
        self.assertTrue(all(set(item) == _MEMBER_KEYS | _REVIEW_KEYS for item in items))
        by_key = {cast(str, item["native_key"]): item for item in items}
        self.assertEqual(
            by_key["promo"],
            self.member_item("PROMOTION", "promo", self.company, ["Amazon.ca"])
            | {
                "assignment_origin": "ADMINISTRATOR",
                "warning": "PRODUCTS_DISAGREE",
                "suggested_company_id": self.other,
                "products": [{"sku": "B", "asin": None, "company_id": self.other}],
            },
        )
        # A promotion charged in Amazon.com without Amazon's record has no marketplace.
        self.assertEqual(
            by_key["spare"],
            {
                "kind": "PROMOTION",
                "seller_namespace": self.seller,
                "amazon_scope": "NA",
                "native_key": "spare",
                "marketplace_names": [],
                "company_id": None,
                "key_id": None,
                "current_version_id": None,
                "assignment_origin": None,
                "warning": "NO_ASSIGNMENT",
                "suggested_company_id": None,
                "products": [],
            },
        )
        self.assertEqual(by_key["idle"]["marketplace_names"], ["Amazon.ca"])
        # A shipment record names no marketplace: its current charges name them.
        self.assertEqual(
            {key: by_key["ship"][key] for key in ("marketplace_names", "assignment_origin")},
            {
                "marketplace_names": ["Amazon.com", "Amazon.com.mx"],
                "assignment_origin": "AUTOMATIC",
            },
        )

    def test_member_tables_show_current_versions_of_their_own_assignments(self) -> None:
        def keys(user: str) -> set[tuple[object, ...]]:
            return set(
                self.as_user(user, "select kind::text,native_id from public.assignment_keys")
            )

        def versions(user: str) -> set[str]:
            rows = self.as_user(user, "select id::text from public.assignment_versions")
            return {str(row[0]) for row in rows}

        self.assertEqual(
            keys(self.member),
            {
                ("SKU", "A"),
                ("CAMPAIGN", "ad"),
                ("PROMOTION", "promo"),
                ("PROMOTION", "quiet"),
                ("SHIPMENT", "ship"),
            },
        )
        self.assertEqual(
            versions(self.member),
            {self.current_version(key) for key in ("A", "ad", "promo", "quiet", "ship")},
        )
        self.assertEqual(keys(self.other_member), {("SKU", "B"), ("SHIPMENT", "theirs")})
        self.assertNotIn(self.earlier_promo, versions(self.other_member))
        self.assertNotIn(self.earlier_promo, versions(self.member))
        self.assertIn(self.earlier_promo, versions(self.administrator))

    def test_accounts_without_a_role_are_denied(self) -> None:
        unassigned = self.account("unassigned")
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.as_user(unassigned, _READ)
        self.assertEqual(
            self.as_user(unassigned, "select count(*) from public.assignment_keys"), [(0,)]
        )

    def test_prepared_generic_plans_recheck_current_ownership(self) -> None:
        self.connection.execute("set local plan_cache_mode='force_generic_plan'")
        self.connection.execute(_PREPARE_OWNED)
        self.connection.execute(_PREPARE_LISTED)

        def snapshot(user: str) -> tuple[object, ...]:
            owned = self.as_user(user, "execute owned_assignments")[0]
            return (*owned, self.as_user(user, "execute listed_assignments")[0][0])

        self.assertEqual(
            snapshot(self.member),
            (["A", "ad", "promo", "quiet", "ship"], 5, ["ad", "promo", "quiet", "ship"]),
        )
        self.assertEqual(snapshot(self.other_member), (["B", "theirs"], 2, ["theirs"]))
        self.as_user(
            self.administrator,
            "select public.set_reference_assignment(%s,'NA','SHIPMENT','ship',%s,%s,%s)",
            (self.seller, self.other, self.current_version("ship"), "Moved to company B"),
        )
        self.assertEqual(
            snapshot(self.member), (["A", "ad", "promo", "quiet"], 4, ["ad", "promo", "quiet"])
        )
        self.assertEqual(
            snapshot(self.other_member), (["B", "ship", "theirs"], 3, ["ship", "theirs"])
        )
        self.connection.execute(
            "delete from public.app_accounts where user_id=%s", (self.other_member,)
        )
        self.assertEqual(self.as_user(self.other_member, "execute owned_assignments"), [([], 0)])
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.as_user(self.other_member, "execute listed_assignments")

    def test_read_functions_are_caller_bound_and_narrowly_granted(self) -> None:
        rows = self.connection.execute(
            "select format('%s.%s',p.pronamespace::regnamespace,p.proname),"
            "p.pronargs,p.prosecdef,p.provolatile::text,"
            "p.proconfig,has_function_privilege('authenticated',p.oid,'EXECUTE'),"
            "has_function_privilege('anon',p.oid,'EXECUTE'),"
            "has_function_privilege('service_role',p.oid,'EXECUTE'),"
            "exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
            "where a.grantee=0 and a.privilege_type='EXECUTE') "
            "from pg_proc p where p.oid in ('private.current_owned_assignments()'::regprocedure,"
            "'private.read_reference_assignments()'::regprocedure,"
            "'public.reference_assignments()'::regprocedure) order by 1"
        ).fetchall()
        self.assertEqual(
            [(row[0], *row[1:4], *row[5:]) for row in rows],
            [
                ("private.current_owned_assignments", 0, True, "s", True, False, False, False),
                ("private.read_reference_assignments", 0, True, "s", True, False, False, False),
                ("public.reference_assignments", 0, False, "s", True, False, False, False),
            ],
        )
        self.assertTrue(all('search_path=""' in cast(list[str], row[4]) for row in rows))
        self.assertEqual(
            self.connection.execute(
                "select pg_get_function_result("
                "'private.current_owned_assignments()'::regprocedure),"
                "to_regclass('public.assignment_status'),"
                "has_table_privilege('authenticated','private.assignment_candidates','SELECT'),"
                "has_table_privilege('authenticated','private.reference_charges','SELECT')"
            ).fetchone(),
            ("TABLE(key_id uuid, version_id uuid)", None, False, False),
        )
