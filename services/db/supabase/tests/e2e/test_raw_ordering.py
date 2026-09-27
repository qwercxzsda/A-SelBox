"""Raw amount/date pages preserve their exact view results through real Auth and REST."""

import csv
import io
from dataclasses import replace
from typing import cast

from services.db.supabase.benchmarks.datasets import DATASETS, Dataset, canonical_rows
from services.db.supabase.benchmarks.search_cases import SearchCase
from services.db.supabase.tests.e2e.fixtures import (
    archived_data_kiosk,
    archived_settlement,
    company_with_fees,
    settlement_document,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.amazon.settlement_tabular import SETTLEMENT_V2_COLUMNS
from services.sync.src.archives.storage import archive_document
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    persist_data_kiosk_acquisition,
    persist_settlement_acquisition,
)
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_report

EXACT_AMOUNT = "9007199254740993.123456789012345678901"
EXACT_QUANTITY = "9007199254740993"


def reference_parameters(case: SearchCase) -> dict[str, str]:
    """Use direct view reads as an independent oracle for the page RPC."""
    dataset = case.dataset
    column = dataset.date_column if case.order_by == "date" else dataset.amount_column
    nulls = "nullsfirst" if case.descending_date else "nullslast"
    tie_direction = "desc" if case.descending_date else "asc"
    parameters = {
        "select": ",".join(dataset.columns),
        "order": ",".join(
            [
                f"{column}.{case.direction}.{nulls}",
                *(name + "." + tie_direction for name in dataset.tie_columns),
            ]
        ),
        "limit": "25",
        "offset": str(case.offset),
    }
    if dataset.key == "live":
        parameters["and"] = "(or(source.neq.DATA_KIOSK,source_amount.neq.0))"
    elif dataset.key == "data_kiosk":
        parameters["amount"] = "neq.0"
    if case.marketplace is not None:
        parameters["marketplace_name"] = "eq." + case.marketplace
    return parameters


class RawOrderingTests(LocalWorkflowCase):
    def publish_sources(self, seller: str) -> None:
        acquisition = archived_settlement(self.storage, seller)
        rows = list(
            csv.DictReader(
                io.StringIO(settlement_document(str(acquisition.id)).decode()), delimiter="\t"
            )
        )
        for row in rows:
            if row["transaction-type"] in {"Order", "Refund"}:
                row["amount"] = ("-" if row["transaction-type"] == "Refund" else "") + EXACT_AMOUNT
                row["quantity-purchased"] = EXACT_QUANTITY
        text = io.StringIO()
        writer = csv.DictWriter(
            text, fieldnames=SETTLEMENT_V2_COLUMNS, delimiter="\t", lineterminator="\r\n"
        )
        writer.writeheader()
        writer.writerows(rows)
        acquisition = replace(
            acquisition,
            document=archive_document(
                self.storage, text.getvalue().encode(), source_compression=None
            ),
        )
        settlement = persist_settlement_acquisition(self.database, acquisition)
        kiosk = persist_data_kiosk_acquisition(
            self.database, archived_data_kiosk(self.storage, seller)
        )
        # Operators retain both versions in raw tabs; members remain current-only.
        for _ in range(2):
            preprocess_settlement_report(self.database, self.storage, settlement)
            preprocess_data_kiosk_acquisition(self.database, self.storage, kiosk)

    def assert_equivalent(
        self, token: str, dataset: Dataset, order_by: str, direction: str, sellers: set[str]
    ) -> None:
        case = SearchCase(dataset, "authenticated", order_by, direction, marketplace="Amazon.com")
        reference = self.stack.request(
            "GET",
            "/rest/v1/" + dataset.relation,
            token=token,
            params=reference_parameters(case),
            headers={"Accept": "text/csv", "Prefer": "count=exact"},
        )
        self.assertEqual(reference.status_code, 200)
        expected = canonical_rows(
            list(csv.DictReader(io.StringIO(reference.text), quoting=csv.QUOTE_NOTNULL))
        )
        total = reference.headers["Content-Range"].rsplit("/", 1)[1]
        response = self.stack.request(
            "POST",
            "/rest/v1/rpc/" + dataset.endpoint,
            token=token,
            json=case.arguments(include_count=True),
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(canonical_rows(payload["rows"]), expected)
        self.assertEqual(payload["total_count"], total)
        self.assertGreater(len(expected), 1)
        self.assertEqual({row["seller_namespace"] for row in expected}, sellers)
        if order_by == "date":
            keys = [
                tuple(row[field] for field in (dataset.date_column, *dataset.tie_columns))
                for row in expected
            ]
            self.assertTrue(all(all(value is not None for value in key) for key in keys))
            self.assertEqual(keys, sorted(keys, reverse=direction == "desc"))
        if dataset.key != "data_kiosk" and order_by == "amount" and direction == "desc":
            self.assertEqual(expected[0][dataset.amount_column], EXACT_AMOUNT)
            self.assertEqual(expected[0]["quantity"], EXACT_QUANTITY)
        for offset in (0, 1):
            page = self.stack.request(
                "POST",
                "/rest/v1/rpc/" + dataset.endpoint,
                token=token,
                json={**case.arguments(), "p_limit": 1, "p_offset": offset},
            )
            self.assertEqual(page.status_code, 200)
            self.assertEqual(canonical_rows(page.json()["rows"]), expected[offset : offset + 1])
            self.assertIsNone(page.json()["total_count"])

    def test_amount_and_date_ordering_preserve_precision_history_and_access(self) -> None:
        company = company_with_fees(self.database, self.seller)
        other_seller = self.seller + "-other"
        company_with_fees(self.database, other_seller)
        self.publish_sources(self.seller)
        self.publish_sources(other_seller)
        member_id, member = self.create_member(company)
        _, operator = self.create_operator()
        _, outsider = self.create_auth_user()
        for token, sellers in ((member, {self.seller}), (operator, {self.seller, other_seller})):
            for dataset in DATASETS:
                for order_by in ("amount", "date"):
                    for direction in ("asc", "desc"):
                        with self.subTest(
                            dataset=dataset.key,
                            order_by=order_by,
                            direction=direction,
                            operator=token == operator,
                        ):
                            self.assert_equivalent(token, dataset, order_by, direction, sellers)
                args = SearchCase(dataset, "invalid", "amount", "desc").arguments()
                for patch, code in (
                    ({"p_marketplaces": ["not-a-marketplace"]}, "22023"),
                    ({"p_order_by": "company_amount"}, "22023"),
                ):
                    invalid = self.stack.request(
                        "POST",
                        "/rest/v1/rpc/" + dataset.endpoint,
                        token=token,
                        json={**args, **patch},
                    )
                    self.assertEqual(invalid.status_code, 400)
                    self.assertEqual(invalid.json()["code"], code)
                unmatched = self.stack.request(
                    "POST",
                    "/rest/v1/rpc/" + dataset.endpoint,
                    token=token,
                    json={**args, "p_marketplaces": ["Amazon.co.uk"], "p_include_count": True},
                )
                self.assertEqual(unmatched.status_code, 200)
                self.assertEqual(unmatched.json(), {"rows": [], "total_count": "0"})

        revoked = self.stack.request(
            "DELETE", "/rest/v1/app_accounts", token=operator, params={"user_id": "eq." + member_id}
        )
        self.assertEqual(revoked.status_code, 204)
        for dataset in DATASETS:
            args = SearchCase(dataset, "revoked", "amount", "desc").arguments(include_count=True)
            for token in (member, outsider):
                empty = self.stack.request(
                    "POST", "/rest/v1/rpc/" + dataset.endpoint, token=token, json=args
                )
                self.assertEqual(empty.status_code, 200)
                self.assertEqual(
                    cast(dict[str, object], empty.json()), {"rows": [], "total_count": "0"}
                )
            denied = self.stack.request("POST", "/rest/v1/rpc/" + dataset.endpoint, json=args)
            self.assertIn(denied.status_code, (401, 403))
            self.assertEqual(denied.json()["code"], "42501")
