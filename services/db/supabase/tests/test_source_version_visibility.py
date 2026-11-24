"""Normalized source parents expose only current owned components to members."""

from copy import deepcopy
from typing import Any, cast

import psycopg

from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.source_fixtures import SourceModelFixture
from services.sync.src.finances.workflow import preprocess_finances_acquisition
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.finances import finances_acquisition, native_transaction


class SourceVersionVisibilityTests(SourceModelFixture):
    def test_shared_parent_does_not_expose_another_companys_components(self) -> None:
        first_company, _ = self.owner("SKU-1")
        second_company, _ = self.owner("OTHER")
        native = cast(dict[str, Any], native_transaction("MIXED-PARENT"))
        second = deepcopy(native["items"][0])
        second["contexts"][0]["sku"] = "OTHER"
        money = {"currencyCode": "USD", "currencyAmount": "200"}
        second["totalAmount"] = money
        second["breakdowns"][0]["breakdownAmount"] = money
        second["breakdowns"][0]["breakdowns"][0]["breakdownAmount"] = money
        native["items"].append(second)
        native["totalAmount"] = {"currencyCode": "USD", "currencyAmount": "300"}
        storage = MemoryArchiveStorage()
        acquisition = finances_acquisition(storage, [native], summary_amount="300")
        preprocess_finances_acquisition(TransactionDatabase(self.connection), storage, acquisition)
        for company, sku, amount in ((first_company, "SKU-1", 100), (second_company, "OTHER", 200)):
            user = self.member(company)
            self.assertEqual(
                self.as_user(user, "select sku,amount from private.finances_amounts"),
                [(sku, amount)],
            )
            self.assertEqual(
                self.as_user(user, "select count(*) from private.finances_transactions"),
                [(1,)],
            )
        self.assertEqual(
            self.as_user(
                self.administrator(),
                "select count(*),sum(amount) from private.finances_amounts",
            ),
            [(2, 300)],
        )

    def publish_owned_history(self) -> tuple[str, str, str, str, str]:
        company, _ = self.owner()
        other, _ = self.owner("OTHER")
        first = self.transaction("100")
        second = self.transaction("40", sku="OTHER")
        self.finances([first, second])
        old = first["id"]
        updated = self.transaction("120")
        unchanged = self.transaction("40", sku="OTHER")
        self.finances([updated, unchanged])
        return company, other, str(old), str(updated["id"]), str(unchanged["id"])

    def test_members_only_see_current_owned_facts_and_their_parent_references(self) -> None:
        company, other, old, current, other_current = self.publish_owned_history()
        for user, expected in (
            (self.member(company), current),
            (self.member(other), other_current),
        ):
            self.assertEqual(
                self.as_user(user, "select id::text from private.finances_amounts"),
                [(expected,)],
            )
            self.assertEqual(
                self.as_user(user, "select count(*) from private.source_units"), [(1,)]
            )
            self.assertEqual(
                self.as_user(user, "select count(*) from private.finances_transactions"),
                [(1,)],
            )
            self.assertEqual(
                self.as_user(user, "select count(*) from private.source_batch_units"),
                [(1,)],
            )
        administrator = self.administrator()
        self.assertCountEqual(
            self.as_user(administrator, "select id::text from private.finances_amounts"),
            [(old,), (current,), (other_current,)],
        )
        self.assertEqual(
            self.as_user(administrator, "select count(*) from public.finances_preprocess_results"),
            [(2,)],
        )
        self.connection.execute("set constraints all immediate")

    def test_parent_controls_and_batch_inventories_are_not_public_column_grants(self) -> None:
        company, _, _, _, _ = self.publish_owned_history()
        for user in (self.member(company), self.administrator()):
            for query in (
                "select total_amount from private.finances_transactions",
                "select amount_count from private.finances_transactions",
                "select content_sha256 from private.source_unit_versions",
                "select unit_count from private.source_preprocess_batches",
                "select documents from private.source_acquisitions",
            ):
                with (
                    self.subTest(query=query),
                    self.assertRaises(psycopg.errors.InsufficientPrivilege),
                ):
                    self.as_user(user, query)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.as_user(self.member(company), "select * from public.finances_preprocess_results")

    def test_scope_changes_and_revocation_recompute_owned_parent_visibility(self) -> None:
        company, other, _, current, _ = self.publish_owned_history()
        user = self.member(company)
        self.assertEqual(
            self.as_user(user, "select id::text from private.finances_amounts"),
            [(current,)],
        )
        self.connection.execute(
            "update public.app_accounts set company_id=%s where user_id=%s", (other, user)
        )
        self.assertNotEqual(
            self.as_user(user, "select id::text from private.finances_amounts"),
            [(current,)],
        )
        self.connection.execute("delete from public.app_accounts where user_id=%s", (user,))
        self.assertEqual(
            self.as_user(user, "select version_id from private.finances_transactions"), []
        )
        self.assertEqual(self.as_user(user, "select id from private.finances_amounts"), [])
