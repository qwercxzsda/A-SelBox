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

    def test_member_catalog_includes_non_selbox_types_from_both_sources(self) -> None:
        storage = cast(list[str], self.resolve("member", "  sToRaGe  ")["p_search_types"])
        # Finances DATA_KIOSK-category keys remain menu/search choices even
        # when existing fact RLS means they produce no company transaction rows.
        self.assertIn("AGED_STORAGE_FEES", storage)
        self.assertIn("STORAGE_FEES", storage)
        self.assertIn("FBA_STORAGE_FEE", storage)
        self.assertEqual(
            self.resolve("member", "cost_of_goods")["p_search_types"],
            ["COST_OF_GOODS_SOLD"],
        )

    def test_member_catalog_excludes_selbox_types_in_every_dataset(self) -> None:
        finances_type = "SUBSCRIPTION_FEES"
        kiosk_type = "SUBSCRIPTION_FEE"
        for role, dataset, expected in (
            ("member", "live", []),
            ("member", "finances", []),
            ("member", "data_kiosk", []),
            ("administrator", "live", sorted([finances_type, kiosk_type])),
            ("administrator", "finances", [finances_type]),
            ("administrator", "data_kiosk", [kiosk_type]),
        ):
            with self.subTest(role=role, dataset=dataset):
                self.assertEqual(
                    self.resolve(role, "subscription", dataset)["p_search_types"], expected
                )
