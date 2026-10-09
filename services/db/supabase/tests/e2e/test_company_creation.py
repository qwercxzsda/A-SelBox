"""Create companies through real administrator JWTs and immediately assign membership."""

from uuid import uuid7

from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase

_ENDPOINT = "/rest/v1/rpc/create_company"


class CompanyCreationApiTests(LocalWorkflowCase):
    def test_administrator_creates_reuses_and_assigns_company_through_rest(self) -> None:
        _, administrator = self.create_administrator()
        user, unassigned = self.create_auth_user()
        revision = self.stack.request(
            "POST",
            "/rest/v1/rpc/workspace_revisions",
            token=administrator,
            json={"p_sources": ["fees"]},
        ).json()["revisions"]["fees"]
        name = f"New company {uuid7()}"
        response = self.stack.request(
            "POST", _ENDPOINT, token=administrator, json={"company_name": f" \t{name}\n "}
        )
        self.assertEqual(response.status_code, 200)
        company = response.json()[0]
        self.assertEqual(company["name"], name)
        self.assertIs(company["created"], True)
        self.assertEqual(set(company), {"id", "name", "created"})
        after = self.stack.request(
            "POST",
            "/rest/v1/rpc/workspace_revisions",
            token=administrator,
            json={"p_sources": ["fees"]},
        ).json()["revisions"]["fees"]
        self.assertNotEqual(after, revision)
        duplicate = self.stack.request(
            "POST", _ENDPOINT, token=administrator, json={"company_name": name.upper()}
        )
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.json(), [{**company, "created": False}])
        self.assertEqual(self.read_rows("companies", unassigned), [])
        assigned = self.set_membership(administrator, user, company["id"])
        self.assertEqual(assigned.status_code, 200)
        self.assertEqual(
            self.read_rows("companies", unassigned, select="id,name"),
            [{"id": company["id"], "name": name}],
        )

    def test_company_rpc_rejects_invalid_names_and_nonadministrators(self) -> None:
        _, administrator = self.create_administrator()
        _, unassigned = self.create_auth_user(user_metadata={"access_role": "administrator"})
        for token in (None, unassigned):
            for name in ("Unauthorized", " "):
                denied = self.stack.request(
                    "POST", _ENDPOINT, token=token, json={"company_name": name}
                )
                self.assertIn(denied.status_code, (401, 403))
                self.assertEqual(denied.json()["code"], "42501")
        for name in (None, "", " \n\t ", "x" * 201):
            invalid = self.stack.request(
                "POST", _ENDPOINT, token=administrator, json={"company_name": name}
            )
            self.assertEqual(invalid.status_code, 400)
            self.assertEqual(invalid.json()["code"], "22023")
        direct = self.stack.request(
            "POST", "/rest/v1/companies", token=administrator, json={"name": "Direct"}
        )
        self.assertEqual(direct.status_code, 403)
        self.assertEqual(direct.json()["code"], "42501")
