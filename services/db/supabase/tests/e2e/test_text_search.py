"""Resolved search selections survive JSON transport and authenticated paging."""

from typing import Any

from services.db.supabase.tests.e2e.fixtures import (
    archived_data_kiosk,
    archived_settlement,
    company_with_fees,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.db.supabase.tests.search_fixtures import LIVE_SEARCH_FIELDS, SOURCE_SEARCH_FIELDS
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    persist_data_kiosk_acquisition,
    persist_settlement_acquisition,
)
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_report

LITERAL_SKU = 'Search.*_[A]%\\Quoted"Sku한글'
_DATASETS = ("live", "settlement", "data_kiosk")


def _matches(row: dict[str, Any], fields: dict[str, str], selection: dict[str, Any]) -> bool:
    active = [
        (column, selection[name])
        for name, column in fields.items()
        if selection.get(name) is not None
    ]
    return not active or any(row[column] in values for column, values in active)


class TextSearchTests(LocalWorkflowCase):
    def test_exact_search_json_or_sets_pagination_and_revoked_access(self) -> None:
        company = company_with_fees(self.database, self.seller, sku=LITERAL_SKU)
        other = self.seller + "-other"
        company_with_fees(self.database, other, sku="OTHER")
        for seller, sku in ((self.seller, LITERAL_SKU), (other, "OTHER")):
            settlement = persist_settlement_acquisition(
                self.database, archived_settlement(self.storage, seller, sku=sku)
            )
            kiosk = persist_data_kiosk_acquisition(
                self.database, archived_data_kiosk(self.storage, seller, sku=sku)
            )
            preprocess_settlement_report(self.database, self.storage, settlement)
            preprocess_data_kiosk_acquisition(self.database, self.storage, kiosk)
        member_id, member = self.create_member(company)
        _, operator = self.create_operator()
        _, outsider = self.create_auth_user()
        for token in (member, operator):
            for dataset in _DATASETS:
                live = dataset == "live"
                page = "transaction_page" if live else "source_transaction_page"
                count = "transaction_count" if live else "source_transaction_count"
                scope = {} if live else {"p_dataset": dataset}
                fields = LIVE_SEARCH_FIELDS if live else SOURCE_SEARCH_FIELDS
                for order, direction in (("date", "desc"), ("date", "asc"), ("amount", "desc")):
                    body = {**scope, "p_order_by": order, "p_direction": direction, "p_limit": 1000}
                    baseline = self.stack.request(
                        "POST", "/rest/v1/rpc/" + page, token=token, json=body
                    )
                    self.assertEqual(baseline.status_code, 200)
                    rows = baseline.json()["rows"]
                    self.assertTrue(rows)
                    selections: tuple[dict[str, Any], ...] = (
                        {},
                        dict.fromkeys(fields, None),
                        {name: [] for name in fields},
                        {"p_search_skus": [LITERAL_SKU]},
                        {"p_search_skus": [LITERAL_SKU.lower()]},
                        {"p_search_skus": ["OTHER"], "p_search_types": [rows[0]["component_type"]]},
                        {"p_search_skus": [], "p_search_marketplaces": ["Amazon.com"]},
                        {"p_search_types": ["USD"]},
                    )
                    if live:
                        selections += ({"p_search_sources": ["DATA_KIOSK"]},)
                    for selection in selections:
                        expected = [row for row in rows if _matches(row, fields, selection)]
                        for include_count in (True, False):
                            response = self.stack.request(
                                "POST",
                                "/rest/v1/rpc/" + page,
                                token=token,
                                json={
                                    **body,
                                    **selection,
                                    "p_limit": 1,
                                    "p_offset": 1,
                                    "p_include_count": include_count,
                                },
                            )
                            self.assertEqual(response.status_code, 200)
                            self.assertEqual(
                                response.json(),
                                {
                                    "rows": expected[1:2],
                                    "total_count": str(len(expected)) if include_count else None,
                                },
                            )
                        response = self.stack.request(
                            "POST",
                            "/rest/v1/rpc/" + count,
                            token=token,
                            json={**scope, **selection},
                        )
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.json(), str(len(expected)))
                for field in fields:
                    for invalid in ([None], [["Amazon.com"]]):
                        response = self.stack.request(
                            "POST",
                            "/rest/v1/rpc/" + page,
                            token=token,
                            json={**scope, field: invalid},
                        )
                        self.assertEqual(response.status_code, 400)
                        self.assertEqual(response.json()["code"], "22023")

        self.stack.request(
            "DELETE", "/rest/v1/app_accounts", token=operator, params={"user_id": "eq." + member_id}
        ).raise_for_status()
        for dataset in _DATASETS:
            page = "transaction_page" if dataset == "live" else "source_transaction_page"
            count = "transaction_count" if dataset == "live" else "source_transaction_count"
            scope = {} if dataset == "live" else {"p_dataset": dataset}
            body = {**scope, "p_search_skus": [LITERAL_SKU]}
            for token in (member, outsider):
                result = self.stack.request("POST", "/rest/v1/rpc/" + page, token=token, json=body)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json(), {"rows": [], "total_count": "0"})
                result = self.stack.request("POST", "/rest/v1/rpc/" + count, token=token, json=body)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json(), "0")
            for endpoint in (page, count):
                response = self.stack.request("POST", "/rest/v1/rpc/" + endpoint, json=body)
                self.assertIn(response.status_code, (401, 403))
                self.assertEqual(response.json()["code"], "42501")
