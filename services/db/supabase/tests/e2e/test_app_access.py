"""Operator and member access through real Auth-issued JWTs and PostgREST."""

import base64
import json
import unittest
from decimal import Decimal
from typing import cast

from services.db.supabase.tests.e2e.fixtures import (
    START,
    archived_data_kiosk,
    archived_settlement,
    company_with_fees,
    fixture_sku,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    persist_data_kiosk_acquisition,
    persist_settlement_acquisition,
)
from services.sync.src.database.company_terms import create_company
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_acquisition


class AppAccessTests(LocalWorkflowCase):
    """Service credentials create Auth fixtures; app operations use ordinary JWTs."""

    def test_one_sku_assignment_combines_namespaces_through_rest_and_transfers_together(
        self,
    ) -> None:
        sku = fixture_sku(self.seller)
        company = company_with_fees(self.database, self.seller, sku=sku)
        other = create_company(self.database, "Other global SKU owner")
        _, member = self.create_member(company)
        _, other_member = self.create_member(other)
        _, operator = self.create_operator()
        for seller in (self.seller, self.seller + "-second"):
            settlement = persist_settlement_acquisition(
                self.database, archived_settlement(self.storage, seller, sku=sku)
            )
            kiosk = persist_data_kiosk_acquisition(
                self.database, archived_data_kiosk(self.storage, seller, sku=sku)
            )
            preprocess_settlement_acquisition(self.database, self.storage, settlement)
            preprocess_data_kiosk_acquisition(self.database, self.storage, kiosk)
        assignments = self.read_rows("company_skus", member)
        self.assertEqual(len(assignments), 1)
        self.assertEqual(assignments[0]["sku"], sku)
        self.assertNotIn("seller_namespace", assignments[0])
        for token, count in ((member, "8"), (other_member, "0")):
            for endpoint in ("transaction_page", "transaction_count", "transaction_totals"):
                body: dict[str, object] = {"p_skus": [sku]}
                if endpoint == "transaction_totals":
                    body["p_date_from"] = START.isoformat()
                result = self.stack.request(
                    "POST", "/rest/v1/rpc/" + endpoint, token=token, json=body
                )
                self.assertEqual(result.status_code, 200)
                payload = result.json()
                if endpoint == "transaction_count":
                    self.assertEqual(payload, count)
                elif endpoint == "transaction_page":
                    self.assertEqual(payload["total_count"], count)
                    self.assertEqual(len(payload["rows"]), int(count))
                elif count == "0":
                    self.assertEqual(payload["rows"], [])
                else:
                    self.assertEqual(payload["rows"][0]["row_count"], count)
                    self.assertEqual(Decimal(payload["rows"][0]["company_amount"]), -20)
        current = self.read_rows("skus", operator, sku="eq." + sku)[0]
        published = self.stack.request(
            "POST",
            "/rest/v1/rpc/publish_sku_configuration",
            token=operator,
            json={
                "p_changes": [
                    {
                        "sku": sku,
                        "company_id": other,
                        "expected_current_version_id": current["current_terms_version_id"],
                        "periods": [
                            {
                                "marketplace_name": "Amazon.com",
                                "valid_from": START.isoformat(),
                                "valid_to": None,
                                "fee_rate_percent": "10",
                            }
                        ],
                    }
                ],
                "p_change_reason": "Transfer the global SKU across both source namespaces",
            },
        )
        self.assertEqual(published.status_code, 200)
        for token, count in ((member, "0"), (other_member, "8")):
            result = self.stack.request(
                "POST", "/rest/v1/rpc/transaction_page", token=token, json={"p_skus": [sku]}
            )
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["total_count"], count)
            self.assertEqual(len(result.json()["rows"]), int(count))

    def test_operator_manages_existing_accounts_and_existing_tokens_follow_access(self) -> None:
        first = company_with_fees(self.database, self.seller)
        second = company_with_fees(self.database, self.seller + "-second")
        for seller in (self.seller, self.seller + "-second"):
            acquisition = persist_settlement_acquisition(
                self.database, archived_settlement(self.storage, seller)
            )
            preprocess_settlement_acquisition(self.database, self.storage, acquisition)
        operator_id, operator_token = self.create_operator()
        user_id, member_token = self.create_auth_user()
        self.assertEqual(self.read_rows("app_accounts", member_token), [])
        self.assertEqual(self.read_rows("company_skus", member_token), [])

        created = self.stack.request(
            "POST",
            "/rest/v1/app_accounts",
            token=operator_token,
            json={"user_id": user_id, "company_id": first},
            headers={"Prefer": "return=representation"},
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()[0]["access_role"], "company_member")
        self.assertEqual(
            self.read_rows("app_accounts", member_token, select="user_id,company_id"),
            [{"user_id": user_id, "company_id": first}],
        )
        self.assertEqual(
            {row["company_id"] for row in self.read_rows("company_skus", member_token)}, {first}
        )
        self.assertEqual(
            {
                row["seller_namespace"]
                for row in self.read_rows("settlement_preprocess_entries", member_token)
            },
            {self.seller},
        )
        self.assertEqual(
            self.read_rows("app_accounts", member_token, user_id="eq." + operator_id), []
        )
        self.assertEqual(
            len(self.read_rows("app_accounts", operator_token, user_id="eq." + user_id)), 1
        )

        updated = self.stack.request(
            "PATCH",
            "/rest/v1/app_accounts",
            token=operator_token,
            params={"user_id": "eq." + user_id},
            json={"company_id": second},
            headers={"Prefer": "return=representation"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()[0]["company_id"], second)
        self.assertEqual(
            {row["company_id"] for row in self.read_rows("company_skus", member_token)}, {second}
        )
        self.assertEqual(
            {
                row["seller_namespace"]
                for row in self.read_rows("settlement_preprocess_entries", member_token)
            },
            {self.seller + "-second"},
        )
        self.assertEqual(self.read_rows("company_skus", member_token, company_id="eq." + first), [])

        removed = self.stack.request(
            "DELETE",
            "/rest/v1/app_accounts",
            token=operator_token,
            params={"user_id": "eq." + user_id},
            headers={"Prefer": "return=representation"},
        )
        self.assertEqual(removed.status_code, 200)
        self.assertEqual([row["user_id"] for row in removed.json()], [user_id])
        for relation in (
            "app_accounts",
            "company_skus",
            "companies",
            "live_company_components",
            "settlement_preprocess_entries",
        ):
            self.assertEqual(self.read_rows(relation, member_token), [])
        # Removing app access leaves the existing Auth identity and session intact.
        auth_user = self.stack.request("GET", "/auth/v1/user", token=member_token)
        self.assertEqual(auth_user.status_code, 200)
        self.assertEqual(auth_user.json()["id"], user_id)

    def test_metadata_cannot_grant_access_and_api_cannot_change_roles_or_user_ids(self) -> None:
        company = create_company(self.database, "Access boundary company")
        operator_id, operator_token = self.create_operator()
        member_id, member_token = self.create_member(company)
        outsider_id, outsider_token = self.create_auth_user(
            user_metadata={"access_role": "operator", "company_id": company}
        )
        claims = json.loads(base64.urlsafe_b64decode(outsider_token.split(".")[1] + "=="))
        self.assertEqual(claims["role"], "authenticated")
        self.assertEqual(claims["user_metadata"]["access_role"], "operator")
        metadata = self.stack.request(
            "PUT",
            "/auth/v1/user",
            token=outsider_token,
            json={"data": {"access_role": "operator", "company_id": company}},
        )
        self.assertEqual(metadata.status_code, 200)
        self.assertEqual(metadata.json()["user_metadata"]["access_role"], "operator")
        self.assertEqual(self.read_rows("app_accounts", outsider_token), [])
        self.assertEqual(self.read_rows("companies", outsider_token), [])

        for role, token in (("member", member_token), ("no account", outsider_token)):
            with self.subTest(role=role, operation="insert"):
                denied = self.stack.request(
                    "POST",
                    "/rest/v1/app_accounts",
                    token=token,
                    json={"user_id": outsider_id, "company_id": company},
                )
                self.assertEqual(denied.status_code, 403)
                self.assertEqual(denied.json()["code"], "42501")
            for method, payload in (("PATCH", {"company_id": company}), ("DELETE", None)):
                with self.subTest(role=role, operation=method):
                    denied = self.stack.request(
                        method,
                        "/rest/v1/app_accounts",
                        token=token,
                        params={"user_id": "eq." + member_id},
                        json=payload,
                        headers={"Prefer": "return=representation"},
                    )
                    self.assertEqual(denied.status_code, 200)
                    self.assertEqual(denied.json(), [])

        for token in (member_token, outsider_token, operator_token):
            for payload in ({"access_role": "operator"}, {"user_id": outsider_id}):
                with self.subTest(operation="forbidden column", fields=tuple(payload)):
                    denied = self.stack.request(
                        "PATCH",
                        "/rest/v1/app_accounts",
                        token=token,
                        params={"user_id": "eq." + member_id},
                        json=payload,
                    )
                    self.assertEqual(denied.status_code, 403)
                    self.assertEqual(denied.json()["code"], "42501")
        promoted = self.stack.request(
            "POST",
            "/rest/v1/app_accounts",
            token=operator_token,
            json={"user_id": outsider_id, "company_id": None, "access_role": "operator"},
        )
        self.assertEqual(promoted.status_code, 403)
        self.assertEqual(promoted.json()["code"], "42501")
        for method, payload in (("PATCH", {"company_id": company}), ("DELETE", None)):
            unchanged = self.stack.request(
                method,
                "/rest/v1/app_accounts",
                token=operator_token,
                params={"user_id": "eq." + operator_id},
                json=payload,
                headers={"Prefer": "return=representation"},
            )
            self.assertEqual(unchanged.status_code, 200)
            self.assertEqual(unchanged.json(), [])
        self.assertEqual(
            self.read_rows(
                "app_accounts",
                operator_token,
                user_id="eq." + member_id,
                select="company_id,access_role",
            ),
            [{"company_id": company, "access_role": "company_member"}],
        )
        self.assertEqual(
            self.read_rows("app_accounts", operator_token, user_id="eq." + outsider_id), []
        )

    def test_operator_publishes_complete_configuration_and_members_only_read_current_ownership(
        self,
    ) -> None:
        company = create_company(self.database, "Configuration RPC company")
        other = create_company(self.database, "New configuration owner")
        _, operator_token = self.create_operator()
        _, member_token = self.create_member(company)
        _, recipient_token = self.create_member(other)
        _, outsider_token = self.create_auth_user()
        change: dict[str, object] = {
            "sku": fixture_sku(self.seller),
            "company_id": company,
            "expected_current_version_id": None,
            "periods": [
                {
                    "marketplace_name": "Amazon.com",
                    "valid_from": START.isoformat(),
                    "valid_to": None,
                    "fee_rate_percent": "0",
                }
            ],
        }
        payload = {"p_changes": [change], "p_change_reason": "First complete publication"}
        for token in (member_token, outsider_token):
            denied = self.stack.request(
                "POST", "/rest/v1/rpc/publish_sku_configuration", token=token, json=payload
            )
            self.assertEqual(denied.status_code, 403)
            self.assertEqual(denied.json()["code"], "42501")
        published = self.stack.request(
            "POST", "/rest/v1/rpc/publish_sku_configuration", token=operator_token, json=payload
        )
        self.assertEqual(published.status_code, 200)
        first = cast(str, published.json()["published"][0]["terms_version_id"])
        selected = self.read_rows(
            "company_skus", member_token, sku="eq." + fixture_sku(self.seller)
        )
        self.assertEqual(len(selected), 1)
        periods = self.read_rows("sku_fee_periods", member_token, terms_version_id="eq." + first)
        self.assertEqual(len(periods), 1)
        self.assertEqual(periods[0]["fee_rate_percent"], 0)
        change.update(expected_current_version_id=first, company_id=None, periods=[])
        incomplete = self.stack.request(
            "POST", "/rest/v1/rpc/publish_sku_configuration", token=operator_token, json=payload
        )
        self.assertEqual(incomplete.status_code, 400)
        self.assertEqual(incomplete.json()["code"], "23514")
        self.assertEqual(incomplete.json()["message"], "SKU configuration is incomplete")
        self.assertEqual(
            self.read_rows("company_skus", member_token, sku="eq." + fixture_sku(self.seller)),
            selected,
        )
        change.update(company_id=other)
        transferred = self.stack.request(
            "POST", "/rest/v1/rpc/publish_sku_configuration", token=operator_token, json=payload
        )
        self.assertEqual(transferred.status_code, 200)
        second = cast(str, transferred.json()["published"][0]["terms_version_id"])
        self.assertNotEqual(first, second)
        self.assertEqual(self.read_rows("company_skus", member_token), [])
        self.assertEqual(len(self.read_rows("company_skus", recipient_token)), 1)
        for token in (member_token, recipient_token):
            self.assertEqual(self.read_rows("sku_terms_versions", token, id="eq." + first), [])
            self.assertEqual(
                self.read_rows("sku_fee_periods", token, terms_version_id="eq." + first), []
            )
        history = self.read_rows(
            "sku_terms_versions",
            operator_token,
            id=f"in.({first},{second})",
            order="version_number",
        )
        self.assertEqual([row["company_id"] for row in history], [company, other])
        self.assertEqual([row["version_number"] for row in history], [1, 2])
        self.assertEqual(
            self.read_rows("sku_fee_periods", operator_token, terms_version_id="eq." + first),
            periods,
        )
        stale = self.stack.request(
            "POST", "/rest/v1/rpc/publish_sku_configuration", token=operator_token, json=payload
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["code"], "PT409")
        self.assertEqual(stale.json()["message"], "SKU configuration changed while editing")
        for relation in ("skus", "sku_terms_versions", "sku_fee_periods"):
            denied = self.stack.request(
                "POST", "/rest/v1/" + relation, token=operator_token, json={}
            )
            self.assertEqual(denied.status_code, 403)
            self.assertEqual(denied.json()["code"], "42501")

    def test_operator_reads_source_history_while_member_only_reads_owned_current_facts(
        self,
    ) -> None:
        company = company_with_fees(self.database, self.seller)
        _, operator_token = self.create_operator()
        _, member_token = self.create_member(company)
        settlement = persist_settlement_acquisition(
            self.database, archived_settlement(self.storage, self.seller)
        )
        kiosk = persist_data_kiosk_acquisition(
            self.database, archived_data_kiosk(self.storage, self.seller)
        )
        for _ in range(2):
            preprocess_settlement_acquisition(self.database, self.storage, settlement)
            preprocess_data_kiosk_acquisition(self.database, self.storage, kiosk)
        for relation, count, current_count in (
            ("settlement_preprocess_results", 2, 1),
            ("data_kiosk_preprocess_results", 4, 2),
        ):
            rows = self.read_rows(relation, operator_token, seller_namespace="eq." + self.seller)
            self.assertEqual(len(rows), count)
            self.assertEqual(sum(row["is_current"] is True for row in rows), current_count)
            denied = self.stack.request(
                "GET",
                "/rest/v1/" + relation,
                token=member_token,
                params={"seller_namespace": "eq." + self.seller},
            )
            self.assertEqual(denied.status_code, 403)
            self.assertEqual(denied.json()["code"], "42501")
        for relation, operator_count, member_count in (
            ("settlement_preprocess_entries", 6, 2),
            # Each day also retains its zero net-sales comparison component.
            ("data_kiosk_preprocess_entries", 8, 4),
        ):
            with self.subTest(relation=relation):
                self.assertEqual(
                    len(
                        self.read_rows(
                            relation, operator_token, seller_namespace="eq." + self.seller
                        )
                    ),
                    operator_count,
                )
                self.assertEqual(
                    len(
                        self.read_rows(relation, member_token, seller_namespace="eq." + self.seller)
                    ),
                    member_count,
                )
        for token in (operator_token, member_token):
            private = self.stack.request(
                "GET",
                "/rest/v1/settlement_acquisitions",
                token=token,
                headers={"Accept-Profile": "private"},
            )
            self.assertEqual(private.status_code, 406)
            self.assertEqual(private.json()["code"], "PGRST106")


if __name__ == "__main__":
    unittest.main()
