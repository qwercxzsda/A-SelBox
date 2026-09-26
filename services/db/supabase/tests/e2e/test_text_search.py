"""Visible-field literal search and count parity cross real Auth/PostgREST."""

from services.db.supabase.benchmarks.ordering_cases import DATASETS, canonical_rows
from services.db.supabase.benchmarks.search_cases import SEARCH_COLUMNS, SearchCase
from services.db.supabase.benchmarks.table_verification import read_reference
from services.db.supabase.tests.e2e.fixtures import (
    archived_data_kiosk,
    archived_settlement,
    company_with_fees,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    persist_data_kiosk_acquisition,
    persist_settlement_acquisition,
)
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_report

LITERAL_SKU = 'Search.*_[A]%\\Quoted"Sku한글'


class TextSearchTests(LocalWorkflowCase):
    users: dict[str, str]

    def assert_matches_view(self, token: str, case: SearchCase) -> list[dict[str, str | None]]:
        # The view oracle runs under this authenticated actor. SQL allows the
        # marketplace text; JSON retains exact text/backslash/numeric data.
        with self.database.connection() as connection:
            reference = read_reference(connection, self.users[token], case)
        if reference is None:
            self.fail("A below-cap reference was required")
        expected = reference["rows"]
        count = reference["total_count"]
        for include_count in (True, False):
            response = self.stack.request(
                "POST",
                "/rest/v1/rpc/" + case.dataset.endpoint,
                token=token,
                json=case.arguments(include_count=include_count),
            )
            self.assertEqual(response.status_code, 200)
            actual = canonical_rows(response.json()["rows"])
            self.assertEqual(len(actual), len(expected))
            for row, reference_row in zip(actual, expected, strict=True):
                self.assertEqual(set(row), set(reference_row))
                for field, value in row.items():
                    self.assertEqual(value, reference_row[field], field)
            self.assertEqual(response.json()["total_count"], count if include_count else None)
        response = self.stack.request(
            "POST", "/rest/v1/rpc/" + case.count_endpoint, token=token, json=case.count_arguments()
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), count)
        return expected

    def test_visible_literals_hidden_metadata_and_revoked_access(self) -> None:
        company = company_with_fees(self.database, self.seller, sku=LITERAL_SKU)
        other = self.seller + "-other"
        company_with_fees(self.database, other, sku=LITERAL_SKU)
        for seller in (self.seller, other):
            settlement = persist_settlement_acquisition(
                self.database, archived_settlement(self.storage, seller, sku=LITERAL_SKU)
            )
            kiosk = persist_data_kiosk_acquisition(
                self.database, archived_data_kiosk(self.storage, seller, sku=LITERAL_SKU)
            )
            preprocess_settlement_report(self.database, self.storage, settlement)
            preprocess_data_kiosk_acquisition(self.database, self.storage, kiosk)
        member_id, member = self.create_member(company)
        operator_id, operator = self.create_operator()
        outsider_id, outsider = self.create_auth_user()
        self.users = {member: member_id, operator: operator_id, outsider: outsider_id}
        for role, token in (("member", member), ("operator", operator)):
            for dataset in DATASETS:
                for term in (
                    LITERAL_SKU.lower(),
                    ".*",
                    "[A]",
                    "%",
                    "_",
                    "\\",
                    '"',
                    "한글",
                    "usd",
                    "u",
                    "us",
                    "amazon.com",
                    "zz_absent_218754",
                    "",
                ):
                    with self.subTest(role=role, dataset=dataset.key, term=term):
                        case = SearchCase(dataset, "literal", "date", "desc", search=term)
                        rows = self.assert_matches_view(token, case)
                        if term in (LITERAL_SKU.lower(), ".*", "[A]", "%", "\\", '"', "한글"):
                            self.assertTrue(rows)
                            self.assertTrue(all(row["sku"] == LITERAL_SKU for row in rows))
                        if role == "member":
                            self.assertTrue(
                                all(row["seller_namespace"] == self.seller for row in rows)
                            )
                for direction in ("asc", "desc"):
                    self.assert_matches_view(
                        token, SearchCase(dataset, "amount", "amount", direction, search="usd")
                    )
                base = SearchCase(dataset, "default", "date", "desc", search="")
                normal = self.stack.request(
                    "POST", "/rest/v1/rpc/" + dataset.endpoint, token=token, json=base.arguments()
                )
                visible = [
                    str(row[field]).casefold()
                    for row in normal.json()["rows"]
                    for field in SEARCH_COLUMNS[dataset.key]
                    if row[field] is not None
                ]
                kind = normal.json()["rows"][0]["component_type"]
                self.assertTrue(
                    self.assert_matches_view(
                        token, SearchCase(dataset, "visible_type", "date", "desc", search=kind)
                    )
                )
                for field in (
                    ("family", "accounting_subtype")
                    if dataset.key == "settlement"
                    else ("source_document_id",)
                    if dataset.key == "data_kiosk"
                    else ()
                ):
                    term = next((row[field] for row in normal.json()["rows"] if row[field]), None)
                    if term is not None:
                        rows = self.assert_matches_view(
                            token,
                            SearchCase(dataset, "hidden_metadata", "date", "desc", search=term),
                        )
                        if not any(term.casefold() in value for value in visible):
                            self.assertFalse(rows)
                for term in (self.seller, "APPLIED", "NOT_APPLICABLE"):
                    self.assertFalse(
                        self.assert_matches_view(
                            token, SearchCase(dataset, "hidden", "date", "desc", search=term)
                        )
                    )
                for search in (None, "", " \t\n"):
                    body = base.arguments()
                    body["p_search"] = search
                    response = self.stack.request(
                        "POST", "/rest/v1/rpc/" + dataset.endpoint, token=token, json=body
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json(), normal.json())
                omitted = base.arguments()
                omitted.pop("p_search")
                response = self.stack.request(
                    "POST", "/rest/v1/rpc/" + dataset.endpoint, token=token, json=omitted
                )
                self.assertEqual(response.json(), normal.json())
            current = self.stack.request(
                "POST",
                "/rest/v1/rpc/transaction_page",
                token=token,
                json={"p_include_count": False},
            ).json()["rows"]
            version = next(
                row["preprocess_version"] for row in current if row["source"] == "SETTLEMENT"
            )
            self.assertFalse(
                self.assert_matches_view(
                    token, SearchCase(DATASETS[0], "hidden_version", "date", "desc", search=version)
                )
            )
            for term in ("settlement", "data_kiosk", "Settlements", "Data Kiosk"):
                rows = self.assert_matches_view(
                    token, SearchCase(DATASETS[0], "metadata", "date", "desc", search=term)
                )
                self.assertTrue(rows)

        self.stack.request(
            "DELETE", "/rest/v1/app_accounts", token=operator, params={"user_id": "eq." + member_id}
        ).raise_for_status()
        for dataset in DATASETS:
            case = SearchCase(dataset, "denied", "date", "desc", search=LITERAL_SKU)
            for token in (member, outsider):
                rows = self.assert_matches_view(token, case)
                self.assertFalse(rows)
            for endpoint, args in (
                (dataset.endpoint, case.arguments()),
                (case.count_endpoint, case.count_arguments()),
            ):
                response = self.stack.request("POST", "/rest/v1/rpc/" + endpoint, json=args)
                self.assertIn(response.status_code, (401, 403))
                self.assertEqual(response.json()["code"], "42501")
