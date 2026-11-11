"""Raw amount/date pages preserve their exact view results through real Auth and REST."""

from typing import cast

from services.db.supabase.benchmarks.datasets import DATASETS, Dataset, canonical_rows
from services.db.supabase.benchmarks.search_cases import SearchCase
from services.db.supabase.benchmarks.table_verification import read_reference
from services.db.supabase.tests.e2e.fixtures import (
    archived_data_kiosk,
    archived_finances,
    company_with_fees,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    persist_data_kiosk_acquisition,
)
from services.sync.src.finances.workflow import preprocess_finances_acquisition

EXACT_AMOUNT = "9007199254740993.123456789012345678901"
EXACT_QUANTITY = "9007199254740993"


class RawOrderingTests(LocalWorkflowCase):
    def publish_sources(self, seller: str) -> None:
        finances = archived_finances(
            self.storage, seller, sale_amount=EXACT_AMOUNT, quantity=int(EXACT_QUANTITY)
        )
        kiosk = persist_data_kiosk_acquisition(
            self.database, archived_data_kiosk(self.storage, seller)
        )
        # Repeated preprocessing reuses contents and records both observations.
        for _ in range(2):
            preprocess_finances_acquisition(self.database, self.storage, finances)
            preprocess_data_kiosk_acquisition(self.database, self.storage, kiosk)

    def assert_equivalent(
        self,
        actor: str,
        token: str,
        dataset: Dataset,
        order_by: str,
        direction: str,
        sellers: set[str],
    ) -> None:
        case = SearchCase(dataset, "authenticated", order_by, direction, marketplace="Amazon.com")
        with self.database.connection() as connection:
            reference = read_reference(connection, actor, case)
        if reference is None:
            self.fail("Small ordering fixture unexpectedly exceeded the amount limit")
        expected = reference["rows"]
        total = reference["total_count"]
        response = self.stack.request(
            "POST",
            "/rest/v1/rpc/" + dataset.endpoint,
            token=token,
            json=case.arguments(include_count=True),
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        actual = canonical_rows(payload["rows"])
        self.assertEqual(len(actual), len(expected))
        for actual_row, expected_row in zip(actual, expected, strict=True):
            self.assertEqual(actual_row.keys(), expected_row.keys())
            differences = {
                key: (expected_row.get(key), actual_row.get(key))
                for key in actual_row.keys() | expected_row.keys()
                if expected_row.get(key) != actual_row.get(key)
            }
            self.assertFalse(differences, differences)
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
        administrator_id, administrator = self.create_administrator()
        _, outsider = self.create_auth_user()
        for actor, token, sellers in (
            (member_id, member, {self.seller}),
            (administrator_id, administrator, {self.seller, other_seller}),
        ):
            for dataset in DATASETS:
                if dataset.key != "live" and token == member:
                    denied = self.stack.request(
                        "POST",
                        "/rest/v1/rpc/" + dataset.endpoint,
                        token=token,
                        json=SearchCase(dataset, "member_denied", "date", "desc").arguments(),
                    )
                    self.assertEqual(denied.status_code, 403)
                    self.assertEqual(denied.json()["code"], "42501")
                    continue
                for order_by in ("amount", "date"):
                    for direction in ("asc", "desc"):
                        with self.subTest(
                            dataset=dataset.key,
                            order_by=order_by,
                            direction=direction,
                            administrator=token == administrator,
                        ):
                            self.assert_equivalent(
                                actor, token, dataset, order_by, direction, sellers
                            )
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

        revoked = self.set_membership(administrator, member_id, None)
        self.assertEqual(revoked.status_code, 200)
        for dataset in DATASETS:
            args = SearchCase(dataset, "revoked", "amount", "desc").arguments(include_count=True)
            for token in (member, outsider):
                empty = self.stack.request(
                    "POST", "/rest/v1/rpc/" + dataset.endpoint, token=token, json=args
                )
                if dataset.key == "live":
                    self.assertEqual(empty.status_code, 200)
                    self.assertEqual(
                        cast(dict[str, object], empty.json()), {"rows": [], "total_count": "0"}
                    )
                else:
                    self.assertEqual(empty.status_code, 403)
                    self.assertEqual(empty.json()["code"], "42501")
            denied = self.stack.request("POST", "/rest/v1/rpc/" + dataset.endpoint, json=args)
            self.assertIn(denied.status_code, (401, 403))
            self.assertEqual(denied.json()["code"], "42501")
