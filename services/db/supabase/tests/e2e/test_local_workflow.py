"""Real local Storage, PostgreSQL, Auth, and PostgREST workflow verification."""

import hashlib
import lzma
import unittest
from datetime import UTC, date, datetime
from decimal import Decimal
from unittest.mock import Mock

import psycopg
from psycopg import sql

from services.db.supabase.tests.e2e.fixtures import (
    END,
    START,
    archived_data_kiosk,
    archived_finances,
    company_with_fees,
    fixture_sku,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.amazon.finances.client import FinancesResponse
from services.sync.src.archives.storage import (
    SOURCE_ARCHIVE_BUCKET,
    ArchiveIntegrityError,
    archive_document,
    load_document_archive,
)
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    load_data_kiosk_acquisition,
    persist_data_kiosk_acquisition,
)
from services.sync.src.database.company_terms import create_company, publish_sku_terms
from services.sync.src.database.payout_reports import publish_company_payout_report
from services.sync.src.finances.acquisition import download_finances_acquisition
from services.sync.src.finances.acquisition_models import FinancesCoverageMarketplace
from services.sync.src.finances.workflow import preprocess_finances_acquisition

ACQUISITION_LOG = "services.sync.src.archives.acquisition_logging"


class LocalWorkflowTests(LocalWorkflowCase):
    """Share one disposable stack; each case uses distinct source and company identities."""

    def test_original_company_retains_frozen_payout_after_current_sku_reassignment(self) -> None:
        month_end = date(2026, 8, 31)
        company = company_with_fees(self.database, self.seller)
        _, original_token = self.create_member(company)
        _, administrator_token = self.create_administrator()
        finances = archived_finances(self.storage, self.seller, end_date=month_end)
        kiosk = persist_data_kiosk_acquisition(
            self.database, archived_data_kiosk(self.storage, self.seller, end_date=month_end)
        )
        preprocess_finances_acquisition(self.database, self.storage, finances)
        preprocess_data_kiosk_acquisition(self.database, self.storage, kiosk)
        with self.database.connection() as connection:
            canonical = connection.execute(
                "select distinct current_batch_id from "
                "private.finances_transactions where seller_namespace=%s",
                (self.seller,),
            ).fetchone()
            selected = connection.execute(
                "select current_terms_version_id from public.skus where sku=%s",
                (fixture_sku(self.seller),),
            ).fetchone()
        if canonical is None or selected is None:
            self.fail("Expected published source and terms identities.")
        report_id = publish_company_payout_report(
            self.database,
            company_id=company,
            marketplace_name="Amazon.com",
            currency="USD",
            start_date=START,
            end_date=month_end,
            report_name="Frozen company report",
            change_reason="Initial source-backed report",
        )
        header = self.read_rows(
            "company_payout_reports",
            administrator_token,
            id="eq." + report_id,
        )
        components = self.read_rows(
            "company_payout_report_components",
            administrator_token,
            report_id="eq." + report_id,
            order="row_number",
        )
        self.assertEqual(len(header), 1)
        self.assertNotIn("reconciliation_count", header[0])
        self.assertEqual(header[0]["company_amount"], -10)
        self.assertEqual(header[0]["marketplace_name"], "Amazon.com")
        self.assertEqual(len(components), 4)
        self.assertEqual(sum(row["authoritative"] is True for row in components), 4)
        member_components = [row for row in components if row["authoritative"]]
        self.assertEqual(sum(Decimal(str(row["company_amount"])) for row in member_components), -10)
        self.assertEqual({row["terms_version_id"] for row in components}, {str(selected[0])})
        self.assertEqual(header[0]["finances_batch_count"], 1)
        self.assertEqual(header[0]["data_kiosk_observation_count"], 31)
        self.assertEqual(header[0]["terms_version_count"], 1)
        self.assert_saved_source_totals(report_id, administrator_token, original_token)
        for relation, count in (
            ("payout_report_finances_batches", 1),
            ("payout_report_data_kiosk_observations", 31),
            ("payout_report_terms_versions", 1),
        ):
            self.assertEqual(
                len(self.read_rows(relation, administrator_token, report_id="eq." + report_id)),
                count,
            )
            self.assertEqual(
                self.read_rows(relation, original_token, report_id="eq." + report_id), []
            )
        self.assertEqual(
            self.read_rows("company_payout_reports", original_token, id="eq." + report_id),
            header,
        )
        self.assertEqual(
            self.read_rows(
                "company_payout_report_components",
                original_token,
                report_id="eq." + report_id,
                order="row_number",
            ),
            member_components,
        )

        next_company = create_company(self.database, "New current owner")
        _, next_token = self.create_member(next_company)
        publish_sku_terms(
            self.database,
            sku=fixture_sku(self.seller),
            company_id=next_company,
            expected_current_version_id=str(selected[0]),
            periods=[],
            change_reason="Correct owner",
        )
        for token, visible_components in (
            (administrator_token, components),
            (original_token, member_components),
        ):
            self.assertEqual(
                self.read_rows("company_payout_reports", token, id="eq." + report_id),
                header,
            )
            self.assertEqual(
                self.read_rows(
                    "company_payout_report_components",
                    token,
                    report_id="eq." + report_id,
                    order="row_number",
                ),
                visible_components,
            )
        self.assertEqual(self.read_rows("live_company_components", original_token), [])
        self.assertEqual(len(self.read_rows("finances_preprocess_entries", next_token)), 2)
        self.assertEqual(
            self.read_rows(
                "company_payout_reports",
                next_token,
                id="eq." + report_id,
            ),
            [],
        )
        self.assertEqual(
            self.read_rows(
                "company_payout_report_components", next_token, report_id="eq." + report_id
            ),
            [],
        )
        for token in (original_token, next_token):
            self.assertEqual(
                self.read_rows("sku_terms_versions", token, id="eq." + str(selected[0])), []
            )
        self.assert_saved_source_totals(report_id, administrator_token, original_token)

    def assert_saved_source_totals(self, report_id: str, administrator: str, member: str) -> None:
        """Read exact source aggregates through Auth/PostgREST without diagnostic arithmetic."""
        endpoint = "/rest/v1/rpc/report_source_totals"
        response = self.stack.request(
            "POST", endpoint, token=administrator, json={"p_report_id": report_id}
        )
        self.assertEqual(response.status_code, 200, response.text)
        totals = response.json()
        self.assertEqual(
            totals["scope"],
            {
                "report_id": report_id,
                "start_date": "2026-08-01",
                "end_date": "2026-08-31",
                "marketplace_name": "Amazon.com",
                "currency": "USD",
            },
        )
        self.assertIsNone(totals["revision"])
        self.assertEqual(totals["total_count"], "1")
        self.assertIsNone(totals["next_offset"])
        self.assertEqual(
            {(row["source"], row["category"]): Decimal(row["amount"]) for row in totals["rows"]},
            {
                ("FINANCES", "FINANCES"): Decimal(0),
                ("FINANCES", "DATA_KIOSK"): Decimal(-10),
                ("DATA_KIOSK", "DATA_KIOSK"): Decimal(-12),
            },
        )
        self.assertEqual(
            {item["source"] for item in totals["coverage"]}, {"FINANCES", "DATA_KIOSK"}
        )
        for offset, day, expected_rows, next_offset in (
            (0, "2026-08-01", 2, 1),
            (1, "2026-08-02", 3, None),
        ):
            page = self.stack.request(
                "POST",
                endpoint,
                token=administrator,
                json={
                    "p_report_id": report_id,
                    "p_grouping": "day",
                    "p_limit": 1,
                    "p_offset": offset,
                },
            )
            self.assertEqual(page.status_code, 200, page.text)
            body = page.json()
            self.assertEqual(body["total_count"], "2")
            self.assertEqual(body["next_offset"], next_offset)
            self.assertEqual(len(body["rows"]), expected_rows)
            self.assertEqual({row["period"] for row in body["rows"]}, {day})
            self.assertEqual({row["source"] for row in body["rows"]}, {"FINANCES", "DATA_KIOSK"})
            for row in body["rows"]:
                self.assertIsInstance(row["amount"], str)
                self.assertNotIn("difference", row)
                self.assertNotIn("accounted_total", row)
        denied = self.stack.request("POST", endpoint, token=member, json={"p_report_id": report_id})
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()["code"], "42501")
        current = self.stack.request(
            "POST",
            "/rest/v1/rpc/current_source_totals",
            token=administrator,
            json={
                "p_start": "2026-08-01",
                "p_end": "2026-08-31",
                "p_marketplace": "Amazon.com",
                "p_currency": "USD",
                "p_grouping": "day",
                "p_limit": 1000,
            },
        )
        self.assertEqual(current.status_code, 200, current.text)
        self.assertEqual(set(current.json()["revision"]), {"finances", "data_kiosk"})
        self.assertTrue(
            any(row["seller_namespace"] == self.seller for row in current.json()["rows"])
        )

    def test_both_sources_publish_complete_company_financial_rows_through_authenticated_rest(
        self,
    ) -> None:
        members: list[tuple[str, str, str]] = []
        for seller in (self.seller, self.seller + "-other"):
            company = company_with_fees(self.database, seller)
            _, token = self.create_member(company)
            finances = archived_finances(self.storage, seller)
            kiosk = archived_data_kiosk(self.storage, seller)
            finances_id = finances
            kiosk_id = persist_data_kiosk_acquisition(self.database, kiosk)
            self.assertEqual(load_data_kiosk_acquisition(self.database, kiosk_id), kiosk)
            preprocess_finances_acquisition(self.database, self.storage, finances_id)
            preprocess_data_kiosk_acquisition(self.database, self.storage, kiosk_id)
            members.append((seller, company, token))

        for seller, company, token in members:
            with self.subTest(seller=seller):
                rows = self.read_rows(
                    "live_company_components",
                    token,
                    select=(
                        "source,seller_namespace,sku,company_id,source_amount,fee_amount,"
                        "company_amount,resolution_status,activity_date"
                    ),
                    authoritative="eq.true",
                    order="source,activity_date",
                )
                self.assertEqual(len(rows), 4)
                self.assertEqual({row["seller_namespace"] for row in rows}, {seller})
                self.assertEqual({row["company_id"] for row in rows}, {company})
                self.assertEqual({row["sku"] for row in rows}, {fixture_sku(seller)})
                self.assertEqual(
                    [
                        (
                            row["source"],
                            Decimal(str(row["source_amount"])),
                            Decimal(str(row["fee_amount"])),
                            Decimal(str(row["company_amount"])),
                            row["resolution_status"],
                        )
                        for row in rows
                    ],
                    [
                        ("DATA_KIOSK", Decimal(-7), Decimal(0), Decimal(-7), "NOT_APPLICABLE"),
                        ("DATA_KIOSK", Decimal(-5), Decimal(0), Decimal(-5), "NOT_APPLICABLE"),
                        ("FINANCES", Decimal(100), Decimal(-5), Decimal(95), "APPLIED"),
                        ("FINANCES", Decimal(-100), Decimal(7), Decimal(-93), "APPLIED"),
                    ],
                )
                self.assertEqual(
                    sum((Decimal(str(row["company_amount"])) for row in rows), Decimal(0)),
                    Decimal(-10),
                )
                for relation, category, expected in (
                    ("finances_preprocess_entries", "FINANCES", [100, -100]),
                    ("data_kiosk_preprocess_entries", "DATA_KIOSK", [-7, -5]),
                ):
                    values = self.read_rows(
                        relation, token, select="seller_namespace,amount", category="eq." + category
                    )
                    self.assertEqual({row["seller_namespace"] for row in values}, {seller})
                    self.assertCountEqual([row["amount"] for row in values], expected)
                other_seller = next(item[0] for item in members if item[0] != seller)
                self.assertEqual(
                    self.read_rows(
                        "live_company_components", token, seller_namespace="eq." + other_seller
                    ),
                    [],
                )

    def test_private_schema_and_acquisition_rpc_stay_outside_authenticated_api(self) -> None:
        company = company_with_fees(self.database, self.seller)
        _, token = self.create_member(company)
        acquisition = archived_finances(self.storage, self.seller)
        identifier = acquisition
        preprocess_finances_acquisition(self.database, self.storage, identifier)
        self.assertEqual(len(self.read_rows("finances_preprocess_entries", token)), 2)

        anonymous = self.stack.request("GET", "/rest/v1/live_company_components")
        self.assertEqual(anonymous.status_code, 401)
        for relation, category in (
            ("finances_preprocess_entries", "SELBOX"),
            ("finances_preprocess_entries", "DATA_KIOSK"),
            ("data_kiosk_preprocess_entries", "SELBOX"),
        ):
            with self.subTest(relation=relation):
                denied = self.stack.request(
                    "GET",
                    "/rest/v1/" + relation,
                    token=token,
                    params={"category": "eq." + category},
                )
                self.assertEqual(denied.status_code, 200)
                self.assertEqual(denied.json(), [])
        for relation in ("finances_acquisitions", "data_kiosk_acquisitions"):
            with self.subTest(private_relation=relation):
                self.assertEqual(
                    self.stack.request("GET", "/rest/v1/" + relation, token=token).status_code,
                    404,
                )
        private_profile = self.stack.request(
            "GET",
            "/rest/v1/finances_acquisitions",
            token=token,
            headers={"Accept-Profile": "private"},
        )
        self.assertEqual(private_profile.status_code, 406)
        self.assertEqual(private_profile.json()["code"], "PGRST106")
        denied_rpc = self.stack.request(
            "POST",
            "/rest/v1/rpc/publish_finances_acquisition",
            token=token,
            json={"p_payload": {}},
        )
        self.assertEqual(denied_rpc.status_code, 404)
        self.assertEqual(denied_rpc.json()["code"], "PGRST202")

    def test_real_storage_roundtrip_retry_and_conflicting_immutable_upload(self) -> None:
        original = f"{self.seller}\r\n".encode() + b"\x00\xff\t exact source bytes\r\n"
        manifest = archive_document(self.storage, original, source_compression="GZIP")
        compressed = self.storage.get(manifest.bucket, manifest.object_path)
        self.assertEqual(lzma.decompress(compressed), original)
        self.assertEqual(hashlib.sha256(compressed).hexdigest(), manifest.archive_sha256)
        self.assertEqual(load_document_archive(self.storage, manifest), original)
        self.assertEqual(
            archive_document(self.storage, original, source_compression="GZIP"), manifest
        )
        with self.assertRaises(ArchiveIntegrityError):
            self.storage.put(manifest.bucket, manifest.object_path, b"conflicting replacement")
        self.assertEqual(self.storage.get(manifest.bucket, manifest.object_path), compressed)
        with self.database.connection() as connection:
            self.assertEqual(
                connection.execute(
                    "select count(*) from storage.objects where bucket_id = %s and name = %s",
                    (manifest.bucket, manifest.object_path),
                ).fetchone(),
                (1,),
            )

    def test_app_roles_and_anonymous_clients_cannot_read_or_write_source_archives(self) -> None:
        company = company_with_fees(self.database, self.seller)
        _, token = self.create_member(company)
        acquisition = archived_finances(self.storage, self.seller)
        manifest = acquisition.documents[0].document
        location = manifest.bucket + "/" + manifest.object_path
        before = self.storage.get(manifest.bucket, manifest.object_path)
        _, administrator_token = self.create_administrator()
        for role, credential in (
            ("anonymous", None),
            ("company", token),
            ("administrator", administrator_token),
        ):
            for prefix in ("object/authenticated/", "object/public/"):
                with self.subTest(role=role, route=prefix):
                    response = self.stack.request(
                        "GET", "/storage/v1/" + prefix + location, token=credential
                    )
                    self.assert_storage_denied(response)
                    self.assertNotEqual(response.content, before)
            with self.subTest(role=role, operation="upload"):
                target = f"e2e-denied/{self.seller}-{role}.xz"
                response = self.stack.request(
                    "POST",
                    f"/storage/v1/object/{SOURCE_ARCHIVE_BUCKET}/{target}",
                    token=credential,
                    content=before,
                    headers={"Content-Type": "application/x-xz"},
                )
                self.assert_storage_denied(response, write=True)
                with self.database.connection() as connection:
                    self.assertEqual(
                        connection.execute(
                            "select count(*) from storage.objects "
                            "where bucket_id = %s and name = %s",
                            (SOURCE_ARCHIVE_BUCKET, target),
                        ).fetchone(),
                        (0,),
                    )
        self.assertEqual(self.storage.get(manifest.bucket, manifest.object_path), before)

    def test_failed_preprocessing_keeps_downloaded_archives_and_previous_success(self) -> None:
        original = archived_finances(self.storage, self.seller)
        preprocess_finances_acquisition(self.database, self.storage, original)
        content = load_document_archive(self.storage, original.documents[0].document)
        summary = load_document_archive(self.storage, original.documents[1].document)
        client = Mock()

        def page(operation: str, _parameters: object) -> FinancesResponse:
            now = datetime.now(UTC)
            return FinancesResponse(content if operation == "transactions" else summary, now, now)

        client.get_page.side_effect = page
        candidate = download_finances_acquisition(
            client,
            self.storage,
            amazon_scope="NA",
            seller_namespace=self.seller,
            query_start_date=START,
            query_end_date=END,
            marketplaces=(
                FinancesCoverageMarketplace("ATVPDKIKX0DER", "Amazon.com", "America/Los_Angeles"),
            ),
        )
        with self.database.connection() as connection, connection.transaction():
            connection.execute(
                sql.SQL("""
                create function private.e2e_reject_finances_acquisition() returns trigger
                language plpgsql as $$ begin
                    if new.seller_namespace = {} then
                        raise exception 'Synthetic acquisition publication failure'
                            using errcode='23514';
                    end if;
                    return new;
                end $$;
                create trigger e2e_reject_finances_acquisition
                before insert on private.finances_acquisitions
                for each row execute function private.e2e_reject_finances_acquisition();
            """).format(sql.Literal(self.seller))
            )
        try:
            with (
                self.assertLogs("services.sync.src.finances.workflow", level="ERROR") as captured,
                self.assertRaises(psycopg.errors.CheckViolation),
            ):
                preprocess_finances_acquisition(self.database, self.storage, candidate)
        finally:
            with self.database.connection() as connection, connection.transaction():
                connection.execute(
                    "drop trigger e2e_reject_finances_acquisition on private.finances_acquisitions"
                )
                connection.execute("drop function private.e2e_reject_finances_acquisition()")
        self.assertNotIn(content.decode(), "\n".join(captured.output))
        for credential in (self.stack.service_key, self.stack.anon_key):
            self.assertNotIn(credential, "\n".join(captured.output))
        self.assertEqual(
            load_document_archive(self.storage, candidate.documents[0].document), content
        )
        with self.database.connection() as connection:
            self.assertEqual(
                connection.execute(
                    "select id::text from private.finances_acquisitions where seller_namespace=%s",
                    (self.seller,),
                ).fetchall(),
                [(str(original.id),)],
            )
            self.assertEqual(
                connection.execute(
                    "select count(*) from private.finances_preprocess_batches "
                    "where acquisition_id=%s",
                    (candidate.id,),
                ).fetchone(),
                (0,),
            )

    def test_missing_archive_blocks_success_and_local_descriptor_can_be_retried(self) -> None:
        acquisition = archived_finances(self.storage, self.seller)
        identifier = acquisition
        manifest = acquisition.documents[0].document
        saved_archive = self.storage.get(manifest.bucket, manifest.object_path)
        response = self.stack.request(
            "DELETE",
            "/storage/v1/object/" + manifest.bucket,
            admin=True,
            json={"prefixes": [manifest.object_path]},
        )
        self.assertEqual(response.status_code, 200)
        with self.assertRaisesRegex(RuntimeError, "missing or inaccessible"):
            preprocess_finances_acquisition(self.database, self.storage, identifier)
        with self.database.connection() as connection:
            self.assertEqual(
                connection.execute(
                    "select count(*) from private.finances_preprocess_batches "
                    "where acquisition_id = %s",
                    (acquisition.id,),
                ).fetchone(),
                (0,),
            )
        self.storage.put(manifest.bucket, manifest.object_path, saved_archive)
        batch_id = preprocess_finances_acquisition(self.database, self.storage, identifier)
        with self.database.connection() as connection:
            self.assertEqual(
                connection.execute(
                    "select acquisition_id::text from private.finances_preprocess_batches "
                    "where id = %s",
                    (batch_id,),
                ).fetchone(),
                (str(acquisition.id),),
            )


if __name__ == "__main__":
    unittest.main()
