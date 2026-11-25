"""Run every frontend client method against Auth and PostgREST on a disposable stack."""

import json
import shutil
import subprocess
from datetime import date
from pathlib import Path

from services.db.supabase.tests.e2e.fixtures import (
    MARKETPLACE_ID,
    START,
    archived_finances,
    company_with_fees,
    fixture_sku,
    publish_ad_invoice,
    publish_inventory,
    publish_named_reference,
    publish_removal_reference,
    publish_storage_references,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.database.payout_reports import publish_company_payout_report
from services.sync.src.finances.workflow import preprocess_finances_acquisition
from services.sync.src.reference.acquisition import ReferenceRequest


class FrontendClientTests(LocalWorkflowCase):
    def seed_promotion(self) -> None:
        raw = {
            "promotionId": "coupon",
            "marketplaceId": MARKETPLACE_ID,
            "selection": {"type": "ITEMS", "selectionDetails": {"items": [{"asin": "B000000001"}]}},
            "schedule": {"startDate": "2026-08-01", "endDate": "2026-08-31"},
            "promotionTitle": "Fixture coupon",
            "promotionType": "COUPON",
            "status": "EXPIRED",
        }
        publish_named_reference(
            self.database,
            self.storage,
            ReferenceRequest("PROMOTION", "NA", MARKETPLACE_ID, self.seller, native_id="coupon"),
            {"body": json.dumps(raw)},
        )

    def test_authenticated_client_contract(self) -> None:
        month_end = date(2026, 8, 31)
        user_id, token = self.create_administrator()
        members: list[dict[str, str]] = []
        items: list[dict[str, object]] = []
        for index in range(2):
            seller = f"{self.seller}-{index}"
            company = company_with_fees(self.database, seller)
            observation = archived_finances(self.storage, seller, end_date=month_end)
            preprocess_finances_acquisition(self.database, self.storage, observation)
            publish_removal_reference(self.database, self.storage, seller)
            member_id, member_token = self.create_member(company)
            members.append({"userId": member_id, "token": member_token, "company": company})
            items.append(
                {
                    "sku": fixture_sku(seller),
                    "source_line_number": index + 2,
                    "available_quantity": index + 1,
                }
            )
        publish_inventory(self.database, self.storage, self.seller, items)
        self.seed_promotion()
        # Every Raw data view lists at least one current row for the administrator.
        publish_storage_references(self.database, self.storage, self.seller)
        publish_ad_invoice(self.database, self.storage, self.seller)
        for index, member in enumerate(members):
            other = members[1 - index]
            other["foreignReport"] = publish_company_payout_report(
                self.database,
                company_id=member["company"],
                marketplace_name="Amazon.com",
                currency="USD",
                start_date=START,
                end_date=month_end,
                change_reason="Client test",
            )
        frontend = Path(__file__).resolve().parents[4] / "frontend/user-webpage"
        docker = shutil.which("docker")
        if docker is None:
            self.fail("Docker is required to run the frontend client.")
        # Join only this test's gateway network namespace; login tokens stay in the stdin pipe.
        run = subprocess.run(  # noqa: S603 - fixed Docker command for our disposable gateway
            [
                docker,
                "run",
                "--rm",
                "-i",
                "--network",
                f"container:supabase_kong_{self.stack.project_id}",
                "-v",
                f"{frontend}:/app:ro",
                "-w",
                "/app",
                "mcr.microsoft.com/playwright:v1.63.0-noble",
                "node",
                "tests/live/verify-client.mjs",
            ],
            input=json.dumps(
                {
                    "publishableKey": self.stack.publishable_key,
                    "admin": {"userId": user_id, "token": token},
                    "members": members,
                }
            ),
            text=True,
            capture_output=True,
            timeout=150,
            check=False,
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        print(run.stdout.strip())
