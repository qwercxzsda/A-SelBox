"""Dedicated JSON RPCs work with general PostgREST aggregation disabled."""

from decimal import Decimal
from typing import cast

from services.db.supabase.tests.e2e.fixtures import archived_settlement, company_with_fees
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.database.acquisitions import persist_settlement_acquisition
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_report


class SummaryRpcTests(LocalWorkflowCase):
    def test_authenticated_summaries_and_options_work_without_rest_aggregates(self) -> None:
        first = company_with_fees(self.database, self.seller)
        second = company_with_fees(self.database, self.seller + "-second")
        for seller in (self.seller, self.seller + "-second"):
            acquisition = persist_settlement_acquisition(
                self.database, archived_settlement(self.storage, seller)
            )
            preprocess_settlement_report(self.database, self.storage, acquisition)
        member_id, member_token = self.create_member(first)
        _, operator_token = self.create_operator()
        _, outsider_token = self.create_auth_user()
        dates: dict[str, object] = {"p_date_from": "2026-08-01", "p_date_to": "2026-08-02"}

        for token, expected_count, expected_amount in (
            (member_token, "2", "2"),
            (operator_token, "4", "4"),
        ):
            for select in ("source_amount.sum()", "currency,source_amount.sum()", "count()"):
                rejected = self.stack.request(
                    "GET",
                    "/rest/v1/live_company_components",
                    token=token,
                    params={"select": select},
                )
                self.assertEqual(rejected.status_code, 400)
                self.assertEqual(rejected.json()["code"], "PGRST123")
            response = self.stack.request(
                "POST", "/rest/v1/rpc/transaction_totals", token=token, json=dates
            )
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertIsNone(payload["next_offset"])
            self.assertEqual(len(payload["rows"]), 1)
            row = payload["rows"][0]
            self.assertEqual(row["currency"], "USD")
            self.assertIsNone(row["component_type"])
            self.assertEqual(row["row_count"], expected_count)
            self.assertEqual(row["known_company_count"], expected_count)
            for field in ("reported_amount", "service_fee", "company_amount"):
                self.assertIsInstance(row[field], str)
            self.assertEqual(Decimal(row["reported_amount"]), Decimal(0))
            self.assertEqual(Decimal(row["company_amount"]), Decimal(expected_amount))
            page = self.stack.request(
                "POST",
                "/rest/v1/rpc/transaction_totals",
                token=token,
                json={**dates, "p_group_by_type": True, "p_limit": 1},
            )
            self.assertEqual(page.status_code, 200)
            self.assertEqual(page.json()["next_offset"], 1)
            continuation = self.stack.request(
                "POST",
                "/rest/v1/rpc/transaction_totals",
                token=token,
                json={**dates, "p_group_by_type": True, "p_limit": 1, "p_offset": 1},
            )
            self.assertEqual(continuation.status_code, 200)
            self.assertIsNone(continuation.json()["next_offset"])
            self.assertNotEqual(
                page.json()["rows"][0]["component_type"],
                continuation.json()["rows"][0]["component_type"],
            )

            options = self.stack.request(
                "POST",
                "/rest/v1/rpc/dataset_filter_options",
                token=token,
                json={"p_dataset": "live", "p_field": "component_type", "p_limit": 1},
            )
            self.assertEqual(options.status_code, 200)
            cursor = options.json()["next_cursor"]
            self.assertIsInstance(cursor, str)
            self.assertEqual(options.json()["values"], [cursor])
            next_options = self.stack.request(
                "POST",
                "/rest/v1/rpc/dataset_filter_options",
                token=token,
                json={
                    "p_dataset": "live",
                    "p_field": "component_type",
                    "p_limit": 1,
                    "p_after": cursor,
                },
            )
            self.assertEqual(next_options.status_code, 200)
            self.assertIsNone(next_options.json()["next_cursor"])
            self.assertEqual(len(next_options.json()["values"]), 1)
            self.assertNotEqual(options.json()["values"], next_options.json()["values"])
            plain_rows = self.stack.request(
                "POST",
                "/rest/v1/rpc/transaction_page",
                token=token,
                json={"p_limit": 1, "p_include_count": False},
            )
            self.assertEqual(plain_rows.status_code, 200)
            self.assertEqual(len(plain_rows.json()["rows"]), 1)

        for filters in (
            {"p_company_ids": [second]},
            {"p_skus": ["missing"]},
            {"p_marketplaces": ["Amazon.co.uk"]},
        ):
            empty = self.stack.request(
                "POST",
                "/rest/v1/rpc/transaction_totals",
                token=member_token,
                json={**dates, **filters},
            )
            self.assertEqual(empty.status_code, 200)
            self.assertEqual(empty.json(), {"rows": [], "next_offset": None})
        invalid = self.stack.request(
            "POST", "/rest/v1/rpc/transaction_totals", token=member_token, json={}
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["code"], "22023")

        self.stack.request(
            "DELETE",
            "/rest/v1/app_accounts",
            token=operator_token,
            params={"user_id": "eq." + member_id},
        ).raise_for_status()
        empty_responses: tuple[tuple[str, dict[str, object], dict[str, object]], ...] = (
            ("transaction_totals", dates, {"rows": [], "next_offset": None}),
            (
                "dataset_filter_options",
                {"p_dataset": "live", "p_field": "sku"},
                {"values": [], "next_cursor": None},
            ),
        )
        for token in (member_token, outsider_token):
            for endpoint, body, expected in empty_responses:
                response = self.stack.request(
                    "POST", "/rest/v1/rpc/" + endpoint, token=token, json=body
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(cast(dict[str, object], response.json()), expected)
        for endpoint, body in (
            ("transaction_totals", dates),
            ("dataset_filter_options", {"p_dataset": "live", "p_field": "sku"}),
        ):
            denied = self.stack.request("POST", "/rest/v1/rpc/" + endpoint, json=body)
            self.assertIn(denied.status_code, (401, 403))
            self.assertEqual(denied.json()["code"], "42501")
