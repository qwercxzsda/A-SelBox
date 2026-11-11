"""Isolated checks for complete successful archive manifests and offline retrieval."""

import copy
from dataclasses import replace
from datetime import UTC, date, datetime
from typing import cast
from uuid import uuid7

import psycopg
from psycopg.types.json import Jsonb

from services.db.supabase.tests.finances_fixtures import finances_capture, native_transaction
from services.db.supabase.tests.integration_support import (
    DatabaseTestCase,
    TransactionDatabase,
)
from services.db.supabase.tests.local_database import require_row
from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from services.sync.src.archives.models import (
    ArchivedDataKioskPage,
    DataKioskAcquisition,
)
from services.sync.src.archives.serialization import data_kiosk_from_payload, data_kiosk_payload
from services.sync.src.archives.storage import archive_document, load_document_archive
from services.sync.src.database.acquisitions import (
    load_data_kiosk_acquisition,
    persist_data_kiosk_acquisition,
)
from services.sync.src.finances.acquisition_models import FinancesAcquisition
from services.sync.src.finances.acquisition_serialization import finances_acquisition_from_payload
from services.sync.src.finances.workflow import preprocess_finances_acquisition
from services.sync.src.source_serialization import source_mapping
from services.sync.tests.support.archives import MemoryArchiveStorage


class TestAcquisitionManifests(DatabaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.database = TransactionDatabase(self.connection)
        self.storage = MemoryArchiveStorage()

    def acquisition(self) -> DataKioskAcquisition:
        created = datetime(2026, 9, 2, 12, tzinfo=UTC)
        query = build_daily_msku_economics_query(
            date(2026, 9, 1), date(2026, 9, 1), "ATVPDKIKX0DER"
        )
        metadata: dict[str, object] = {
            "queryId": "root",
            "query": query,
            "createdTime": created.isoformat(),
            "processingStatus": "DONE",
            "dataDocumentId": "document",
        }
        document = archive_document(
            self.storage, b"malformed unparsed JSONL\xff", source_compression=None
        )
        return DataKioskAcquisition(
            id=uuid7(),
            seller_namespace="seller",
            amazon_scope="NA",
            root_query_id="root",
            root_query_created_at=created,
            query_definition=query,
            schema_version=ECONOMICS_SCHEMA_NAME,
            marketplace_id="ATVPDKIKX0DER",
            query_start_date=date(2026, 9, 1),
            query_end_date=date(2026, 9, 1),
            downloaded_at=created,
            api_metadata=metadata,
            pages=(
                ArchivedDataKioskPage(
                    page_number=1,
                    query_id="root",
                    query_created_at=created,
                    document_kind=DataKioskDocumentKind.DATA,
                    is_terminal=True,
                    document_id="document",
                    document=document,
                    api_metadata=metadata,
                ),
            ),
        )

    def test_both_sources_round_trip_and_capture_retry_retains_identity(self) -> None:
        acquisition = self.acquisition()
        identifier = persist_data_kiosk_acquisition(self.database, acquisition)
        self.assertEqual(load_data_kiosk_acquisition(self.database, identifier), acquisition)
        self.assertEqual(
            persist_data_kiosk_acquisition(self.database, replace(acquisition, id=uuid7())),
            identifier,
        )
        finances = finances_capture(self.storage, [native_transaction(100)])
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_acquisitions"
            ).fetchone(),
            (0,),
        )
        preprocess_finances_acquisition(self.database, self.storage, finances)
        loaded = self.saved_finances(str(finances.id))
        self.assertEqual(loaded, finances)
        preprocess_finances_acquisition(self.database, self.storage, finances)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_acquisitions"
            ).fetchone(),
            (1,),
        )
        self.assertEqual(
            load_document_archive(self.storage, loaded.documents[0].document),
            load_document_archive(self.storage, finances.documents[0].document),
        )

    def saved_finances(self, identifier: str) -> FinancesAcquisition:
        payload = require_row(
            self.connection.execute(
                "select to_jsonb(a)-'created_at' from private.finances_acquisitions a where id=%s",
                (identifier,),
            ).fetchone()
        )[0]
        return finances_acquisition_from_payload(payload)

    def test_changed_capture_retains_original_manifest_and_raw_archives(self) -> None:
        original = finances_capture(self.storage, [native_transaction(100, identifier="native")])
        preprocess_finances_acquisition(self.database, self.storage, original)
        changed = finances_capture(self.storage, [native_transaction(101, identifier="native")])
        preprocess_finances_acquisition(self.database, self.storage, changed)
        self.assertNotEqual(original.id, changed.id)
        self.assertEqual(self.saved_finances(str(original.id)), original)
        self.assertEqual(self.saved_finances(str(changed.id)), changed)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_acquisitions"
            ).fetchone(),
            (2,),
        )
        self.assertEqual(len(self.storage.objects), 4)

    def test_required_archive_values_reject_json_null_and_inexact_lengths(self) -> None:
        acquisition = self.acquisition()
        document = source_mapping(acquisition.pages[0].document)
        for key in (
            "bucket",
            "object_path",
            "document_sha256",
            "document_byte_length",
            "archive_sha256",
            "archive_byte_length",
            "archive_codec",
            "archive_preset",
            "archive_check",
        ):
            invalid = {**document, key: None}
            with (
                self.subTest(key=key),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "select private.assert_archive_document(%s)", (Jsonb(invalid),)
                )
        for value in ("7", 1.5, -1, True):
            with (
                self.subTest(length=value),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(
                    "select private.assert_archive_document(%s)",
                    (Jsonb({**document, "document_byte_length": value}),),
                )

    def test_inconsistent_page_provenance_cannot_publish_a_success(self) -> None:
        base = data_kiosk_payload(self.acquisition())
        for key, value in (
            ("queryId", "different-query"),
            ("createdTime", "2026-09-03T12:00:00Z"),
            ("dataDocumentId", "different-document"),
            ("errorDocumentId", "error"),
            ("pagination", {"nextToken": "missing-page"}),
        ):
            invalid = copy.deepcopy(base)
            pages = cast(list[dict[str, object]], invalid["documents"])
            metadata = cast(dict[str, object], pages[0]["api_metadata"])
            metadata[key] = value
            invalid["api_metadata"] = metadata
            with (
                self.subTest(key=key),
                self.assertRaises(ValueError),
            ):
                persist_data_kiosk_acquisition(self.database, data_kiosk_from_payload(invalid))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_acquisitions"
            ).fetchone(),
            (0,),
        )

    def test_no_data_needs_explicit_absent_document_and_saved_done_metadata(self) -> None:
        original = self.acquisition()
        metadata = dict(original.api_metadata)
        metadata.pop("dataDocumentId")
        page = replace(
            original.pages[0],
            document_kind=DataKioskDocumentKind.NO_DATA,
            document_id=None,
            document=None,
            api_metadata=metadata,
        )
        acquisition = replace(original, pages=(page,), api_metadata=metadata)
        identifier = persist_data_kiosk_acquisition(self.database, acquisition)
        self.assertEqual(load_data_kiosk_acquisition(self.database, identifier), acquisition)
        invalid = data_kiosk_payload(acquisition)
        pages = cast(list[dict[str, object]], invalid["documents"])
        pages[0].pop("document")
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "select private.publish_data_kiosk_acquisition(%s)", (Jsonb(invalid),)
            )
