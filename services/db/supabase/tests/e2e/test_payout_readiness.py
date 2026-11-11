"""Operational payout facts retain caller scope and exact CSV boolean transport."""

import csv
import io

from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.database.company_terms import create_company, publish_sku_terms


class PayoutReadinessReadTests(LocalWorkflowCase):
    def test_csv_facts_are_caller_scoped_and_exclude_private_error_details(self) -> None:
        company = create_company(self.database, f"Payout readiness {self.seller}")
        other = create_company(self.database, f"Other readiness {self.seller}")
        publish_sku_terms(
            self.database,
            sku=self.seller,
            company_id=company,
            expected_current_version_id=None,
            periods=(),
            change_reason="Readiness fixture assignment",
        )
        with self.database.connection() as connection, connection.transaction():
            connection.execute(
                "insert into private.payout_report_refresh_state("
                "company_id,month,failure_count,last_error_sqlstate,last_error_message,"
                "last_failure_reason) values(%s,'2026-08-01',1,'23514',"
                "'Private source diagnostic SECRET','SOURCE_REQUIRED')",
                (company,),
            )
        _, member = self.create_member(company)
        columns = (
            "company_id,company_name,month,eligible,mature,refresh_pending,failure_count,"
            "failure_reason,has_report,has_activity,last_success_at,next_attempt_at"
        )
        response = self.stack.request(
            "GET",
            "/rest/v1/rpc/payout_readiness",
            token=member,
            params={"p_month": "2026-08-01", "select": ",".join(sorted(columns.split(",")))},
            headers={"Accept": "text/csv"},
        )
        self.assertEqual(response.status_code, 200)
        rows = list(csv.DictReader(io.StringIO(response.text)))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["company_id"], company)
        self.assertEqual(rows[0]["failure_reason"], "SOURCE_REQUIRED")
        self.assertEqual(rows[0]["failure_count"], "1")
        self.assertEqual(
            [rows[0][field] for field in ("eligible", "mature", "refresh_pending")],
            ["t", "t", "t"],
        )
        self.assertEqual([rows[0][field] for field in ("has_report", "has_activity")], ["f", "f"])
        self.assertNotIn("SECRET", response.text)
        self.assertNotIn("last_error_message", rows[0])
        self.assertNotIn("last_error_sqlstate", rows[0])
        denied = self.stack.request(
            "GET",
            "/rest/v1/rpc/payout_readiness",
            token=member,
            params={"p_month": "2026-08-01", "p_company_ids": "{" + other + "}"},
        )
        self.assertEqual(denied.status_code, 403)
