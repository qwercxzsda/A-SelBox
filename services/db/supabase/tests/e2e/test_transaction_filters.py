"""Date ordering and source filters cross the real Auth/PostgREST RPC boundary."""

import unittest
from typing import cast

from services.db.supabase.tests.e2e.fixtures import archived_settlement, company_with_fees
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.database.acquisitions import persist_settlement_acquisition
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_report


class TransactionFilterTests(LocalWorkflowCase):
    """Use only this class's isolated services, synthetic documents, and Auth accounts."""

    def assert_page_and_count(
        self,
        token: str,
        filters: dict[str, object],
        *,
        companies: set[str],
        expected_count: int,
    ) -> None:
        page = self.stack.request(
            "POST",
            "/rest/v1/rpc/transaction_page",
            token=token,
            json={**filters, "p_include_count": False},
        )
        self.assertEqual(page.status_code, 200)
        payload = cast(dict[str, object], page.json())
        self.assertEqual(set(payload), {"rows", "total_count"})
        self.assertIsNone(payload["total_count"])
        rows = cast(list[dict[str, object]], payload["rows"])
        self.assertEqual(len(rows), expected_count)
        self.assertEqual({row["company_id"] for row in rows}, companies)
        self.assertTrue(all(row["marketplace_name"] == "Amazon.com" for row in rows))
        for row in rows:
            for field in (
                "source_amount",
                "quantity",
                "fee_amount",
                "company_amount",
                "fee_rate_percent",
            ):
                self.assertIsInstance(row[field], str)
        count = self.stack.request(
            "POST", "/rest/v1/rpc/transaction_count", token=token, json=filters
        )
        self.assertEqual(count.status_code, 200)
        self.assertEqual(count.json(), str(expected_count))

    def test_marketplace_arrays_preserve_matching_rows_and_company_access(self) -> None:
        first = company_with_fees(self.database, self.seller)
        second = company_with_fees(self.database, self.seller + "-second")
        for seller in (self.seller, self.seller + "-second"):
            acquisition = persist_settlement_acquisition(
                self.database, archived_settlement(self.storage, seller)
            )
            preprocess_settlement_report(self.database, self.storage, acquisition)
        _, member_token = self.create_member(first)
        _, operator_token = self.create_operator()

        for role, token, companies, count in (
            ("member", member_token, {first}, 2),
            ("operator", operator_token, {first, second}, 4),
        ):
            matching: tuple[dict[str, object], ...] = (
                {},
                {"p_marketplaces": None},
                {"p_marketplaces": []},
                {"p_marketplaces": ["Amazon.com"]},
                {"p_marketplaces": ["Amazon.com", "Amazon.com"]},
                {"p_marketplaces": ["Amazon.com", "Amazon.co.uk"]},
                {"p_fee_applicable": None},
                {"p_fee_applicable": True},
                {"p_marketplaces": ["Amazon.com"], "p_fee_applicable": True},
            )
            for filters in matching:
                with self.subTest(role=role, filters=filters):
                    self.assert_page_and_count(
                        token, filters, companies=companies, expected_count=count
                    )
            self.assert_page_and_count(
                token, {"p_fee_applicable": False}, companies=set(), expected_count=0
            )
            for direction in ("asc", "desc"):
                dated = self.stack.request(
                    "POST",
                    "/rest/v1/rpc/transaction_page",
                    token=token,
                    json={"p_direction": direction, "p_fee_applicable": True},
                )
                self.assertEqual(dated.status_code, 200)
                ordering = [
                    (row["activity_date"], row["source"], row["source_row_id"])
                    for row in dated.json()["rows"]
                ]
                self.assertEqual(ordering, sorted(ordering, reverse=direction == "desc"))
            for marketplace in ("Amazon.co.uk", "Non-Amazon US"):
                with self.subTest(role=role, known_marketplace_without_rows=marketplace):
                    self.assert_page_and_count(
                        token, {"p_marketplaces": [marketplace]}, companies=set(), expected_count=0
                    )
            for selected in (["not-a-marketplace"], ["Amazon.com", "not-a-marketplace"]):
                for endpoint in ("transaction_page", "transaction_count"):
                    with self.subTest(role=role, endpoint=endpoint, invalid_marketplaces=selected):
                        rejected = self.stack.request(
                            "POST",
                            "/rest/v1/rpc/" + endpoint,
                            token=token,
                            json={"p_marketplaces": selected},
                        )
                        self.assertEqual(rejected.status_code, 400)
                        self.assertEqual(rejected.json()["code"], "22023")

        self.assert_page_and_count(
            member_token,
            {"p_marketplaces": ["Amazon.com"], "p_company_ids": [second]},
            companies=set(),
            expected_count=0,
        )
        self.assert_page_and_count(
            member_token,
            {"p_marketplaces": ["Amazon.com"], "p_company_ids": [first, second]},
            companies={first},
            expected_count=2,
        )
        self.assert_page_and_count(
            operator_token,
            {"p_marketplaces": ["Amazon.com"], "p_company_ids": [second]},
            companies={second},
            expected_count=2,
        )


if __name__ == "__main__":
    unittest.main()
