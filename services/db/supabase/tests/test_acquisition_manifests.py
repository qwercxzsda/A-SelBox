"""Isolated checks for complete successful archive manifests and offline retrieval."""

from services.db.supabase.tests.finances_fixtures import finances_capture, native_transaction
from services.db.supabase.tests.integration_support import (
    DatabaseTestCase,
    TransactionDatabase,
)
from services.db.supabase.tests.local_database import require_row
from services.sync.src.archives.serialization import document_from_payload
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

    def saved_finances(self, identifier: str) -> FinancesAcquisition:
        payload = require_row(
            self.connection.execute(
                "select to_jsonb(a) || jsonb_build_object('posted_after',asked_from,"
                "'posted_before',asked_until) from private.source_acquisitions a where id=%s",
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
            self.connection.execute("select count(*) from private.source_acquisitions").fetchone(),
            (2,),
        )
        self.assertEqual(len(self.storage.objects), 4)

    def test_required_archive_values_reject_json_null_and_inexact_lengths(self) -> None:
        acquisition = finances_capture(self.storage, [native_transaction(100)])
        document = source_mapping(acquisition.documents[0].document)
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
                self.assertRaises((TypeError, ValueError)),
            ):
                document_from_payload(invalid)
        for value in ("7", 1.5, -1, True):
            with (
                self.subTest(length=value),
                self.assertRaises((TypeError, ValueError)),
            ):
                document_from_payload({**document, "document_byte_length": value})
