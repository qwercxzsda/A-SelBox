"""Company deletion returns safe dependency reasons through real Auth and REST."""

import json
from uuid import uuid7

from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.database.company_terms import create_company

_ENDPOINT = "/rest/v1/rpc/delete_company"


class CompanyDeletionApiTests(LocalWorkflowCase):
    def test_administrator_deletes_unused_company_and_can_retry(self) -> None:
        _, administrator = self.create_administrator()
        company = create_company(self.database, f"Unused company {uuid7()}")
        for deleted in (True, False):
            response = self.stack.request(
                "POST", _ENDPOINT, token=administrator, json={"target_company_id": company}
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), [{"id": company, "deleted": deleted}])
        self.assertEqual(self.read_rows("companies", administrator, id="eq." + company), [])
        invalid = self.stack.request(
            "POST", _ENDPOINT, token=administrator, json={"target_company_id": None}
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["code"], "22023")

    def test_membership_rejects_deletion_with_reason_and_preserves_both_records(self) -> None:
        _, administrator = self.create_administrator()
        company = create_company(self.database, f"Assigned company {uuid7()}")
        _, member = self.create_member(company)
        response = self.stack.request(
            "POST", _ENDPOINT, token=administrator, json={"target_company_id": company}
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "PT409")
        self.assertEqual(
            response.json()["message"], "Company cannot be deleted while it has linked records"
        )
        self.assertEqual(json.loads(response.json()["details"]), [{"code": "members", "count": 1}])
        self.assertEqual(len(self.read_rows("companies", member, id="eq." + company)), 1)
        self.assertEqual(self.read_rows("app_accounts", member)[0]["company_id"], company)

    def test_nonadministrators_cannot_delete_or_probe_and_raw_delete_stays_denied(self) -> None:
        _, administrator = self.create_administrator()
        company = create_company(self.database, f"Protected company {uuid7()}")
        _, member = self.create_member(company)
        _, unassigned = self.create_auth_user(user_metadata={"access_role": "administrator"})
        for token in (None, member, unassigned):
            for target in (company, str(uuid7()), None):
                response = self.stack.request(
                    "POST", _ENDPOINT, token=token, json={"target_company_id": target}
                )
                self.assertIn(response.status_code, (401, 403))
                self.assertEqual(response.json()["code"], "42501")
        direct = self.stack.request(
            "DELETE", "/rest/v1/companies", token=administrator, params={"id": "eq." + company}
        )
        self.assertEqual(direct.status_code, 403)
        self.assertEqual(direct.json()["code"], "42501")
