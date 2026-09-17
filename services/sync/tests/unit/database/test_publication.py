"""Publication identity checks distinguish deduplicated inputs from new results."""

import unittest
from uuid import uuid7

from ....src.database.publication import publish_json
from ...support.fakes import FakeDatabaseConnection


class TestPublication(unittest.TestCase):
    def test_new_result_cannot_succeed_with_an_unexpected_identity(self) -> None:
        expected_id = str(uuid7())
        for row in (None, (), (None,), ("not-a-uuid",), (uuid7(),), (uuid7(), uuid7())):
            with self.subTest(row=row), self.assertRaises((TypeError, ValueError, RuntimeError)):
                publish_json(
                    FakeDatabaseConnection([row]),
                    "SELECT private.publish_settlement_preprocess(%(payload)s)",
                    {"id": expected_id},
                    expected_id=expected_id,
                )

    def test_acquisition_deduplication_can_return_its_existing_identity(self) -> None:
        existing_id = uuid7()
        result = publish_json(
            FakeDatabaseConnection([(existing_id,)]),
            "SELECT private.publish_data_kiosk_acquisition(%(payload)s)",
            {"id": str(uuid7())},
        )
        self.assertEqual(result, str(existing_id))


if __name__ == "__main__":
    unittest.main()
