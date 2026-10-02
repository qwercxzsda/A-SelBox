"""Real local Storage, PostgreSQL, Auth, and PostgREST workflow verification."""

import hashlib
import json
import lzma
import unittest
from datetime import date
from decimal import Decimal
from typing import cast
from unittest.mock import Mock, patch
from uuid import uuid7

import psycopg

from services.db.supabase.tests.e2e.fixtures import (
    START,
    archived_data_kiosk,
    archived_settlement,
    company_with_fees,
    fixture_sku,
)
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.sync.src.amazon.reports.models import DownloadedReportDocument
from services.sync.src.archives.storage import (
    SOURCE_ARCHIVE_BUCKET,
    ArchiveIntegrityError,
    archive_document,
    load_document_archive,
)
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    load_data_kiosk_acquisition,
    load_settlement_acquisition,
    persist_data_kiosk_acquisition,
    persist_settlement_acquisition,
)
from services.sync.src.database.company_terms import create_company, publish_sku_terms
from services.sync.src.database.payout_reports import publish_company_payout_report
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_acquisition
from services.sync.src.settlements.acquisition import download_settlement_acquisition

ACQUISITION_LOG = "services.sync.src.archives.acquisition_logging"
SETTLEMENT_LOG = "services.sync.src.settlement_preprocess.workflow"


class LocalWorkflowTests(LocalWorkflowCase):
    """Share one disposable stack; each case uses distinct source and company identities."""

    def test_original_company_retains_frozen_payout_after_current_sku_reassignment(self) -> None:
        month_end = date(2026, 8, 31)
        company = company_with_fees(self.database, self.seller)
        _, original_token = self.create_member(company)
        _, operator_token = self.create_operator()
        settlement = persist_settlement_acquisition(
            self.database, archived_settlement(self.storage, self.seller)
        )
        kiosk = persist_data_kiosk_acquisition(
            self.database, archived_data_kiosk(self.storage, self.seller, end_date=month_end)
        )
        preprocess_settlement_acquisition(self.database, self.storage, settlement)
        preprocess_data_kiosk_acquisition(self.database, self.storage, kiosk)
        with self.database.connection() as connection:
            canonical = connection.execute(
                "select id from private.settlements where seller_namespace=%s", (self.seller,)
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
            currency="USD",
            start_date=START,
            end_date=month_end,
            report_name="Frozen company report",
            change_reason="Initial source-backed report",
        )
        header = self.read_rows(
            "company_payout_reports",
            operator_token,
            id="eq." + report_id,
        )
        components = self.read_rows(
            "company_payout_report_components",
            operator_token,
            report_id="eq." + report_id,
            order="row_number",
        )
        self.assertEqual(len(header), 1)
        self.assertEqual(header[0]["company_amount"], -10)
        self.assertEqual(header[0]["marketplace_names"], ["Amazon.com"])
        self.assertEqual(len(components), 6)
        self.assertEqual(sum(row["authoritative"] is True for row in components), 4)
        self.assertEqual({row["terms_version_id"] for row in components}, {str(selected[0])})
        self.assertEqual(header[0]["settlement_version_count"], 1)
        self.assertEqual(header[0]["data_kiosk_version_count"], 31)
        self.assertEqual(header[0]["terms_version_count"], 1)
        for source, count in (("settlement", 1), ("data_kiosk", 31), ("terms", 1)):
            relation = "payout_report_" + source + "_versions"
            self.assertEqual(
                len(self.read_rows(relation, operator_token, report_id="eq." + report_id)), count
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
            components,
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
        for token in (operator_token, original_token):
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
                components,
            )
        self.assertEqual(self.read_rows("live_company_components", original_token), [])
        self.assertEqual(len(self.read_rows("settlement_preprocess_entries", next_token)), 2)
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

    def test_both_sources_publish_complete_company_financial_rows_through_authenticated_rest(
        self,
    ) -> None:
        members: list[tuple[str, str, str]] = []
        for seller in (self.seller, self.seller + "-other"):
            company = company_with_fees(self.database, seller)
            _, token = self.create_member(company)
            settlement = archived_settlement(self.storage, seller)
            kiosk = archived_data_kiosk(self.storage, seller)
            settlement_id = persist_settlement_acquisition(self.database, settlement)
            kiosk_id = persist_data_kiosk_acquisition(self.database, kiosk)
            self.assertEqual(load_settlement_acquisition(self.database, settlement_id), settlement)
            self.assertEqual(load_data_kiosk_acquisition(self.database, kiosk_id), kiosk)
            preprocess_settlement_acquisition(self.database, self.storage, settlement_id)
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
                        ("SETTLEMENT", Decimal(100), Decimal(-5), Decimal(95), "APPLIED"),
                        ("SETTLEMENT", Decimal(-100), Decimal(7), Decimal(-93), "APPLIED"),
                    ],
                )
                self.assertEqual(
                    sum((Decimal(str(row["company_amount"])) for row in rows), Decimal(0)),
                    Decimal(-10),
                )
                for relation, category, expected in (
                    ("settlement_preprocess_entries", "SETTLEMENT", [100, -100]),
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
        acquisition = archived_settlement(self.storage, self.seller)
        identifier = persist_settlement_acquisition(self.database, acquisition)
        preprocess_settlement_acquisition(self.database, self.storage, identifier)
        self.assertEqual(len(self.read_rows("settlement_preprocess_entries", token)), 2)

        anonymous = self.stack.request("GET", "/rest/v1/live_company_components")
        self.assertEqual(anonymous.status_code, 401)
        for relation, category in (
            ("settlement_preprocess_entries", "SELBOX"),
            ("settlement_preprocess_entries", "DATA_KIOSK"),
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
        for relation in ("settlement_acquisitions", "data_kiosk_acquisitions"):
            with self.subTest(private_relation=relation):
                self.assertEqual(
                    self.stack.request("GET", "/rest/v1/" + relation, token=token).status_code,
                    404,
                )
        private_profile = self.stack.request(
            "GET",
            "/rest/v1/settlement_acquisitions",
            token=token,
            headers={"Accept-Profile": "private"},
        )
        self.assertEqual(private_profile.status_code, 406)
        self.assertEqual(private_profile.json()["code"], "PGRST106")
        denied_rpc = self.stack.request(
            "POST",
            "/rest/v1/rpc/publish_settlement_acquisition",
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
        acquisition = archived_settlement(self.storage, self.seller)
        persist_settlement_acquisition(self.database, acquisition)
        manifest = acquisition.document
        location = manifest.bucket + "/" + manifest.object_path
        before = self.storage.get(manifest.bucket, manifest.object_path)
        _, operator_token = self.create_operator()
        for role, credential in (
            ("anonymous", None),
            ("company", token),
            ("operator", operator_token),
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

    def test_failed_database_publication_retains_upload_and_previous_manifest(self) -> None:
        original = archived_settlement(self.storage, self.seller)
        original_id = persist_settlement_acquisition(self.database, original)
        changed_content = f"changed document {uuid7()}".encode()
        with (
            patch(
                "services.sync.src.settlements.acquisition.download_report_document",
                return_value=DownloadedReportDocument(changed_content, None),
            ),
            self.assertLogs(ACQUISITION_LOG, level="INFO") as captured,
            self.assertRaises(psycopg.errors.CheckViolation),
        ):
            download_settlement_acquisition(
                Mock(),
                self.database,
                self.storage,
                original.reference,
                amazon_scope="NA",
                seller_namespace=self.seller,
            )
        events = [
            cast(dict[str, object], json.loads(record.getMessage())) for record in captured.records
        ]
        failed = [event for event in events if event["event"] == "acquisition_failed"]
        retained = [event for event in events if event["event"] == "archive_retained"]
        self.assertEqual(len(failed), 1)
        self.assertEqual(len(retained), 1)
        self.assertEqual({event["attempt_id"] for event in events}, {failed[0]["attempt_id"]})
        self.assertNotIn("acquisition_published", [event["event"] for event in events])
        self.assertEqual(failed[0]["stage"], "publication")
        self.assertEqual(failed[0]["sqlstate"], "23514")
        self.assertEqual(failed[0]["publication_status"], "unconfirmed")
        self.assertEqual(failed[0]["verified_archive_count"], 1)
        self.assertEqual(failed[0]["seller_namespace"], self.seller)
        self.assertEqual(failed[0]["report_document_id"], original.reference.report_document_id)
        candidate_id = cast(str, failed[0]["candidate_acquisition_id"])
        self.assertEqual(
            retained[0]["document_sha256"], hashlib.sha256(changed_content).hexdigest()
        )
        self.assertNotIn(changed_content.decode(), "\n".join(captured.output))
        for credential in (self.stack.service_key, self.stack.anon_key):
            self.assertTrue(
                credential not in "\n".join(captured.output), "Acquisition logs exposed an API key."
            )
        self.assertEqual(load_settlement_acquisition(self.database, original_id), original)
        with self.assertRaises(LookupError):
            load_settlement_acquisition(self.database, candidate_id)
        self.assertEqual(
            lzma.decompress(
                self.storage.get(
                    cast(str, retained[0]["bucket"]), cast(str, retained[0]["object_path"])
                )
            ),
            changed_content,
        )
        with self.database.connection() as connection:
            self.assertEqual(
                connection.execute(
                    "select count(*) from private.settlement_acquisitions "
                    "where seller_namespace = %s",
                    (self.seller,),
                ).fetchone(),
                (1,),
            )
            self.assertEqual(
                connection.execute(
                    "select count(*) from private.settlement_preprocess_versions "
                    "where acquisition_id in (%s, %s)",
                    (original.id, candidate_id),
                ).fetchone(),
                (0,),
            )

    def test_missing_archive_blocks_preprocessing_and_preserves_saved_acquisition(self) -> None:
        acquisition = archived_settlement(self.storage, self.seller)
        identifier = persist_settlement_acquisition(self.database, acquisition)
        manifest = acquisition.document
        saved_archive = self.storage.get(manifest.bucket, manifest.object_path)
        response = self.stack.request(
            "DELETE",
            "/storage/v1/object/" + acquisition.document.bucket,
            admin=True,
            json={"prefixes": [acquisition.document.object_path]},
        )
        self.assertEqual(response.status_code, 200)
        with (
            self.assertLogs(SETTLEMENT_LOG, level="ERROR") as failure_log,
            self.assertRaisesRegex(RuntimeError, "missing or inaccessible"),
        ):
            preprocess_settlement_acquisition(self.database, self.storage, identifier)
        self.assertEqual(len(failure_log.records), 1)
        self.assertEqual(
            failure_log.records[0].getMessage(),
            "Offline settlement preprocessing failed; "
            f"acquisition_id={identifier} remains retained.",
        )
        self.assertEqual(load_settlement_acquisition(self.database, identifier), acquisition)
        with self.database.connection() as connection:
            self.assertEqual(
                connection.execute(
                    "select count(*) from private.settlement_preprocess_versions "
                    "where acquisition_id = %s",
                    (identifier,),
                ).fetchone(),
                (0,),
            )
        self.storage.put(manifest.bucket, manifest.object_path, saved_archive)
        with self.assertLogs(SETTLEMENT_LOG, level="INFO") as recovery_log:
            version_id = preprocess_settlement_acquisition(self.database, self.storage, identifier)
        self.assertEqual(len(recovery_log.records), 1)
        self.assertIn(
            f"Published settlement source version {version_id}",
            recovery_log.records[0].getMessage(),
        )
        self.assertEqual(recovery_log.records[0].levelname, "INFO")
        with self.database.connection() as connection:
            self.assertEqual(
                connection.execute(
                    "select acquisition_id::text from private.settlement_preprocess_versions "
                    "where id = %s",
                    (version_id,),
                ).fetchone(),
                (identifier,),
            )


if __name__ == "__main__":
    unittest.main()
