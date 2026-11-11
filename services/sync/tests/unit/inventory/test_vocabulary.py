"""The browser's fixed categorical contract matches values accepted by preprocessing."""

import re
import unittest
from pathlib import Path

from services.sync.src.inventory.vocabulary import HEALTH_STATUSES, RECOMMENDED_ACTIONS

_ROOT = Path(__file__).resolve().parents[5]


class InventoryVocabularyTests(unittest.TestCase):
    def test_frontend_metadata_covers_exactly_the_accepted_source_values(self) -> None:
        source = (_ROOT / "services/frontend/user-webpage/src/inventory-options.ts").read_text()
        for name, accepted in (
            ("INVENTORY_HEALTH", HEALTH_STATUSES),
            ("INVENTORY_RECOMMENDATIONS", RECOMMENDED_ACTIONS),
        ):
            with self.subTest(name=name):
                block = re.search(rf"export const {name} = \{{(.*?)\n\}} as const;", source, re.S)
                self.assertIsNotNone(block, f"Missing fixed frontend vocabulary: {name}")
                if block is None:
                    self.fail("Missing frontend vocabulary.")
                keys = re.findall(r'^  (?:"([^"]+)"|(\w+)):\s*\{', block.group(1), re.M)
                self.assertEqual({quoted or bare for quoted, bare in keys}, set(accepted))
