"""Read-only configuration exposes exact current ownership and required fee coverage."""

from datetime import date
from decimal import Decimal

import psycopg

from services.db.supabase.tests.configuration_fixtures import ConfigurationFixture


class SkuConfigurationTests(ConfigurationFixture):
    def test_operator_reads_all_known_exact_skus_but_members_only_their_current_assignments(
        self,
    ) -> None:
        company, identity = self.owner("S1")
        other, _ = self.owner("s1")
        self.assign("S1 ", company)
        self.assign("UNASSIGNED", None)
        previous = self.fee(identity, [("2026-01-01", None, "9")])
        selected = self.fee(identity, [("2026-01-01", None, "5.123456")])
        acquisition = self.acquisition()
        _, old = self.settlement(
            [self.transaction("1", sku="HISTORY-ONLY")], acquisition_id=acquisition
        )
        self.settlement(
            [self.transaction("2", sku="IMPORT-ONLY")],
            acquisition_id=acquisition,
            expected=old,
        )
        operator, member, other_member = self.operator(), self.member(company), self.member(other)
        items = self.configuration(operator)
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

    def test_requirements_union_namespaces_current_sources_and_zero_bases_independent_of_maturity(
        self,
    ) -> None:
        self.owner("S1")
        acquisition = self.acquisition()
        _, previous = self.settlement(
            [self.transaction("100", sku="S1", activity_date="2026-06-01")],
            acquisition_id=acquisition,
        )
        self.settlement(
            [
                self.transaction("0", sku="S1", activity_date="2026-06-15"),
                self.transaction(
                    "100", 4, sku="S1", activity_date="2026-06-20", description="Shipping"
                ),
                self.transaction("-5", 5, sku="S1", activity_date="2026-06-20", kind="Refund")
                | {"marketplace_name": "Amazon.ca"},
            ],
            acquisition_id=acquisition,
            expected=previous,
        )
        self.seller = "seller-two"
        self.settlement([self.transaction("1", sku="S1", activity_date="2026-06-16")])
        self.kiosk(
            1,
            [
                self.component("0", sku="S1", category="SETTLEMENT")
                | {"component_type": "NET_PRODUCT_SALES", "fee_base": "0"}
            ],
            activity_date="2026-06-17",
        )
        self.kiosk(
            1,
            [self.component("0", sku="S1", category="ANALYSIS_ONLY") | {"fee_base": "0"}],
            activity_date="2026-06-18",
        )
        _, old_kiosk = self.kiosk(
            1,
            [self.component("10", sku="S1") | {"fee_base": "10"}],
            activity_date="2026-06-10",
        )
        self.kiosk(
            2,
            [self.component("-5", sku="S1")],
            expected=old_kiosk,
            activity_date="2026-06-10",
        )
        self.kiosk(1, [self.component("-10", sku="S1")], activity_date="2026-06-25")
        operator = self.operator()
        expected = [
            {"marketplace_name": "Amazon.ca", "valid_from": "2026-06-20", "valid_to": "2026-06-21"},
            {
                "marketplace_name": "Amazon.com",
                "valid_from": "2026-06-15",
                "valid_to": "2026-06-19",
            },
        ]
        for cutoff in (date(2026, 1, 1), date(2027, 1, 1)):
            self.set_mature_cutoff_date(cutoff)
            item = self.configuration(operator)[0]
            self.assertEqual(item["requirements"], expected)
            self.assertCountEqual(
                item["issues"],
                [dict(sku="S1", kind="missing_fee", **period) for period in expected],
            )

    def test_noncommission_sources_need_ownership_without_inventing_fee_requirements(self) -> None:
        self.owner("STORAGE")
        self.kiosk(1, [self.component("-10", sku="STORAGE")])
        self.settlement([self.transaction("5", sku="STORAGE", description="Shipping")])
        item = self.configuration(self.operator())[0]
        self.assertEqual(item["requirements"], [])
        self.assertEqual(item["periods"], [])
        self.assertEqual(item["issues"], [])

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
            self.as_user(recipient, "select id from public.sku_terms_versions where id=%s", (old,)),
            [],
        )
