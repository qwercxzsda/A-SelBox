"""Benchmark search catalogs follow the frontend's static Type choices."""

import unittest
from typing import cast
from unittest.mock import Mock

from services.db.supabase.benchmarks.common import Connection
from services.db.supabase.benchmarks.search_resolution import resolve_search_values


class SearchResolutionTests(unittest.TestCase):
    def resolve(self, role: str, term: str, dataset: str = "live") -> dict[str, object]:
        connection = Mock()
        connection.execute.return_value.fetchone.return_value = (role,)
        connection.execute.return_value.fetchall.return_value = []
        return resolve_search_values(cast(Connection, connection), term, dataset)

    def test_transaction_catalog_uses_only_authoritative_source_categories(self) -> None:
        storage = cast(list[str], self.resolve("member", "  sToRaGe  ")["p_search_types"])
        self.assertEqual(
            storage,
            ["FBA_STORAGE_FEE", "LONG_TERM_STORAGE_FEE", "MONTHLY_INVENTORY_STORAGE_FEE"],
        )
        self.assertNotIn("AGED_STORAGE_FEES", storage)
        self.assertNotIn("STORAGE_FEES", storage)
        self.assertEqual(
            self.resolve("member", "product_sales")["p_search_types"], ["PRODUCT_SALES"]
        )
        self.assertEqual(
            self.resolve("member", "cost_of_goods")["p_search_types"],
            [],
        )

    def test_raw_admin_catalogs_retain_native_types_and_member_raw_catalogs_are_empty(self) -> None:
        finances_type = "SUBSCRIPTION_FEES"
        kiosk_type = "SUBSCRIPTION_FEE"
        for role, dataset, expected in (
            ("member", "live", []),
            ("member", "finances", []),
            ("member", "data_kiosk", []),
            ("administrator", "live", [finances_type]),
            ("administrator", "finances", [finances_type]),
            ("administrator", "data_kiosk", [kiosk_type]),
        ):
            with self.subTest(role=role, dataset=dataset):
                self.assertEqual(
                    self.resolve(role, "subscription", dataset)["p_search_types"], expected
                )
