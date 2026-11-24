"""Read-only configuration exposes exact current ownership and required fee coverage."""

from decimal import Decimal
from typing import TypedDict, cast

import psycopg

from services.db.supabase.tests.configuration_fixtures import (
    ConfigurationFixture,
    ConfigurationPeriod,
)


class SavedVersion(TypedDict):
    id: str
    created_at: str
    periods: list[ConfigurationPeriod]


class HistoryPage(TypedDict):
    versions: list[SavedVersion]
    has_next: bool


class SkuConfigurationTests(ConfigurationFixture):
    def test_administrator_reads_all_known_exact_skus_but_members_only_their_current_assignments(
        self,
    ) -> None:
        company, identity = self.owner("S1")
        other, _ = self.owner("s1")
        self.assign("S1 ", company)
        self.assign("UNASSIGNED", None)
        previous = self.fee(identity, [("2026-01-01", None, "9")])
        selected = self.fee(identity, [("2026-01-01", None, "5.123456")])
        acquisition = self.acquisition()
        _, _old = self.finances(
            [
                self.transaction("1", sku="HISTORY-ONLY")
                | {"native_transaction_id": "corrected-sku"}
            ],
            acquisition_id=acquisition,
        )
        self.finances(
            [self.transaction("2", sku="IMPORT-ONLY") | {"native_transaction_id": "corrected-sku"}],
            acquisition_id=acquisition,
        )
        administrator, member, other_member = (
            self.administrator(),
            self.member(company),
            self.member(other),
        )
        items = self.configuration(administrator)
        self.assertEqual(
            [item["sku"] for item in items],
            ["HISTORY-ONLY", "IMPORT-ONLY", "S1", "S1 ", "UNASSIGNED", "s1"],
        )
        by_sku = {item["sku"]: item for item in items}
        self.assertEqual(by_sku["HISTORY-ONLY"]["requirements"], [])
        self.assertIsNone(by_sku["HISTORY-ONLY"]["sku_id"])
        self.assertIsNone(by_sku["IMPORT-ONLY"]["company_id"])
        self.assertIsNone(by_sku["IMPORT-ONLY"]["terms_version_id"])
        self.assertEqual(by_sku["S1"]["sku_id"], identity)
        self.assertEqual(by_sku["S1"]["terms_version_id"], selected)
        self.assertNotEqual(selected, previous)
        self.assertEqual(len(by_sku["S1"]["periods"]), 1)
        self.assertIsInstance(by_sku["S1"]["periods"][0]["fee_rate_percent"], str)
        self.assertEqual(
            Decimal(by_sku["S1"]["periods"][0]["fee_rate_percent"]), Decimal("5.123456")
        )
        self.assertEqual([item["sku"] for item in self.configuration(member)], ["S1", "S1 "])
        self.assertEqual([item["sku"] for item in self.configuration(other_member)], ["s1"])
        self.assertTrue(all("seller_namespace" not in item for item in items))
        self.assertTrue(
            all("seller_namespace" not in period for item in items for period in item["periods"])
        )
        self.connection.execute("delete from public.app_accounts where user_id=%s", (member,))
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.configuration(member)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.configuration(self.auth_user())

    def test_member_reads_only_current_terms_after_transfer_and_cannot_read_history(self) -> None:
        company, identity = self.owner("S1")
        other, _ = self.owner("OTHER")
        old = self.fee(identity, [("2026-01-01", None, "5")])
        member, recipient = self.member(company), self.member(other)
        selected = self.assign("S1", other, rate="7", expected=old)
        self.assertEqual(self.configuration(member), [])
        item = next(item for item in self.configuration(recipient) if item["sku"] == "S1")
        self.assertEqual(item["terms_version_id"], selected)
        self.assertEqual(Decimal(item["periods"][0]["fee_rate_percent"]), Decimal(7))
        self.assertEqual(
            self.as_user(
                recipient, "select id from public.assignment_versions where id=%s", (old,)
            ),
            [],
        )

    def test_saved_schedule_page_limits_versions_and_nests_only_their_periods(self) -> None:
        company, key = self.owner("WITH-HISTORY")
        other, _ = self.owner("OTHER")
        old = self.fee(key, [("2025-01-01", "2026-01-01", "0"), ("2026-01-01", None, "5.123456")])
        latest = self.fee(key, [])
        admin = self.administrator()
        query = "select public.sku_configuration_history(%s,%s,1)"

        first = cast(HistoryPage, self.as_user(admin, query, (key, 0))[0][0])
        self.assertTrue(first["has_next"])
        self.assertEqual([v["id"] for v in first["versions"]], [latest])
        self.assertEqual(first["versions"][0]["periods"], [])
        second = cast(HistoryPage, self.as_user(admin, query, (key, 1))[0][0])["versions"][0]
        self.assertEqual(second["id"], old)
        self.assertEqual(
            second["created_at"],
            self.as_user(
                admin, "select created_at::text from public.assignment_versions where id=%s", (old,)
            )[0][0],
        )
        self.assertEqual(
            [(p["valid_from"], p["valid_to"], p["fee_rate_percent"]) for p in second["periods"]],
            [("2025-01-01", "2026-01-01", "0"), ("2026-01-01", None, "5.123456")],
        )
        own = self.as_user(self.member(company), query, (key, 0))[0][0]
        self.assertEqual(own, {**first, "has_next": False})
        empty: HistoryPage = {"versions": [], "has_next": False}
        self.assertEqual(self.as_user(self.member(other), query, (key, 0)), [(empty,)])
        self.assertEqual(self.as_user(self.auth_user(), query, (key, 0)), [(empty,)])
        self.assertEqual(self.as_user(admin, query, (key, 999)), [(empty,)])
