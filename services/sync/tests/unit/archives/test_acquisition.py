"""Downloads publish only complete archives and leave financial parsing offline."""

import gzip
import unittest
from datetime import UTC, date, datetime
from typing import cast
from unittest.mock import Mock, patch

from services.sync.src.amazon.data_kiosk.economics_downloads import DownloadedEconomicsPage
from services.sync.src.amazon.data_kiosk.errors import DataKioskDocumentError
from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.reports.discovery import (
    discover_settlement_reports,
)
from services.sync.src.amazon.reports.models import DownloadedReportDocument
from services.sync.src.amazon.settlement_models import SettlementReportReference
from services.sync.src.archives.models import DataKioskAcquisition, SettlementAcquisition
from services.sync.src.archives.serialization import (
    data_kiosk_from_payload,
    data_kiosk_payload,
    settlement_from_payload,
    settlement_payload,
)
from services.sync.src.archives.storage import load_document_archive
from services.sync.src.data_kiosk_economics.acquisition import download_data_kiosk_acquisition
from services.sync.src.settlements.download import archive_settlement_report
from services.sync.tests.support.archives import (
    ACQUISITION_MODULE,
    CREATED,
    SETTLEMENT_MODULE,
    MemoryArchiveStorage,
    download_kiosk_acquisition,
    page,
    settlement_reference,
)
from services.sync.tests.support.data_kiosk import FakeDataKioskClient, fake_data_kiosk_downloads
from services.sync.tests.support.settlement_reports import FakePaginatedClient, FakeResponse


class AcquisitionTests(unittest.TestCase):
    def setUp(self) -> None:
        clock = self.enterContext(patch(ACQUISITION_MODULE + ".datetime"))
        clock.now.return_value = datetime(2026, 9, 12, 12, tzinfo=UTC)

    def test_data_kiosk_gzip_is_decoded_and_verified_before_hashing_archive(self) -> None:
        original = b"\xef\xbb\xbf malformed JSONL is still archived\r\n\t"
        storage = MemoryArchiveStorage()
        with (
            patch(
                ACQUISITION_MODULE + ".iter_economics_document_pages",
                return_value=iter(
                    [
                        page(1, terminal=True, content=gzip.compress(original)),
                    ]
                ),
            ),
            patch(ACQUISITION_MODULE + ".persist_data_kiosk_acquisition") as publish,
        ):
            download_kiosk_acquisition(storage)
        acquisition = cast(DataKioskAcquisition, publish.call_args.args[1])
        saved = acquisition.pages[0].document
        if saved is None:
            self.fail("Data page requires an archive.")
        self.assertEqual(saved.source_compression, "GZIP")
        self.assertEqual(load_document_archive(storage, saved), original)

    def test_corrupt_data_kiosk_gzip_never_uploads_or_publishes(self) -> None:
        storage = MemoryArchiveStorage()
        with (
            patch(
                ACQUISITION_MODULE + ".iter_economics_document_pages",
                return_value=iter(
                    [
                        page(1, terminal=True, content=gzip.compress(b"source")[:-2]),
                    ]
                ),
            ),
            patch(ACQUISITION_MODULE + ".persist_data_kiosk_acquisition") as publish,
            self.assertRaises(DataKioskDocumentError),
        ):
            download_kiosk_acquisition(storage)
        publish.assert_not_called()
        self.assertEqual(storage.objects, {})

    def test_real_query_traversal_preserves_original_terminal_response_metadata(self) -> None:
        client = FakeDataKioskClient(
            create_payloads=[{"queryId": "root-query"}, {"queryId": "next-query"}],
            query_payloads=[
                {
                    "processingStatus": "DONE",
                    "createdTime": CREATED.isoformat(),
                    "processingEndTime": "2026-09-01T00:30:00Z",
                    "dataDocumentId": "page-one",
                    "pagination": {"nextToken": "next-page-token"},
                },
                {
                    "processingStatus": "DONE",
                    "createdTime": "2026-09-01T01:00:00Z",
                    "dataDocumentId": "page-two",
                },
            ],
            document_payloads=[{"document": b"bad JSON one\r\n"}, {"document": b"bad JSON two\n"}],
        )
        storage = MemoryArchiveStorage()
        with (
            fake_data_kiosk_downloads(client),
            patch(
                ACQUISITION_MODULE + ".persist_data_kiosk_acquisition", return_value="saved"
            ) as publish,
        ):
            download_data_kiosk_acquisition(
                client,
                Mock(),
                storage,
                seller_namespace="seller",
                amazon_scope="NA",
                marketplace_id="ATVPDKIKX0DER",
                query_start_date=date(2026, 8, 1),
                query_end_date=date(2026, 8, 31),
            )
        acquisition = cast(DataKioskAcquisition, publish.call_args.args[1])
        self.assertEqual(acquisition.root_query_id, "root-query")
        self.assertEqual(acquisition.root_query_created_at, CREATED)
        self.assertEqual(
            acquisition.pages[0].api_metadata["processingEndTime"], "2026-09-01T00:30:00Z"
        )
        self.assertEqual(client.create_calls[1][1], "next-page-token")
        self.assertEqual(acquisition.api_metadata["query"], acquisition.query_definition)
        self.assertNotIn("documentUrl", repr(data_kiosk_payload(acquisition)))

    def test_settlement_archives_malformed_document_without_parsing(self) -> None:
        original = b"\xffbad\r\n\tinvalid body\x00"
        storage = MemoryArchiveStorage()
        reference = settlement_reference(("OTHER-HINT", "ATVPDKIKX0DER"))
        with (
            patch(
                SETTLEMENT_MODULE + ".download_report_document",
                return_value=DownloadedReportDocument(gzip.compress(original), "GZIP"),
            ),
            patch(
                SETTLEMENT_MODULE + ".persist_settlement_acquisition", return_value="saved"
            ) as publish,
        ):
            result = archive_settlement_report(
                Mock(), Mock(), storage, reference, amazon_scope="NA", seller_namespace=" seller "
            )
        acquisition = cast(SettlementAcquisition, publish.call_args.args[1])
        self.assertEqual(result, "saved")
        self.assertEqual(acquisition.id.version, 7)
        self.assertEqual(acquisition.seller_namespace, "seller")
        self.assertEqual(load_document_archive(storage, acquisition.document), original)
        self.assertEqual(acquisition.reference.marketplace_ids, reference.marketplace_ids)
        self.assertEqual(settlement_payload(acquisition)["api_metadata"], reference.api_metadata)
        self.assertEqual(acquisition.api_metadata["createdTime"], "2026-09-01T00:00:00Z")
        self.assertEqual(settlement_from_payload(settlement_payload(acquisition)), acquisition)

    def test_missing_original_report_metadata_fails_before_transfer(self) -> None:
        reference = SettlementReportReference("report", "document", CREATED, ("ATVPDKIKX0DER",))
        with (
            patch(SETTLEMENT_MODULE + ".download_report_document") as download,
            self.assertRaisesRegex(ValueError, "original Reports API metadata"),
        ):
            archive_settlement_report(
                Mock(),
                Mock(),
                MemoryArchiveStorage(),
                reference,
                amazon_scope="NA",
                seller_namespace="seller",
            )
        download.assert_not_called()

    def test_settlement_without_marketplace_hints_can_be_discovered_and_archived(self) -> None:
        original_metadata = dict(settlement_reference().api_metadata)
        del original_metadata["marketplaceIds"]
        reports: tuple[dict[str, object], ...] = (
            original_metadata,
            original_metadata | {"marketplaceIds": list[str]()},
            original_metadata | {"marketplaceIds": None},
        )
        for metadata in reports:
            with self.subTest(metadata=metadata):
                client = FakePaginatedClient([FakeResponse({"reports": [metadata]}, None)])
                discovered = discover_settlement_reports(
                    client,
                    marketplace_ids=["ATVPDKIKX0DER"],
                    amazon_scope="NA",
                    created_since=CREATED,
                    created_until=CREATED,
                )
                storage = MemoryArchiveStorage()
                with (
                    patch(
                        SETTLEMENT_MODULE + ".download_report_document",
                        return_value=DownloadedReportDocument(b"unparsed source", None),
                    ),
                    patch(
                        SETTLEMENT_MODULE + ".persist_settlement_acquisition", return_value="saved"
                    ) as publish,
                ):
                    archive_settlement_report(
                        Mock(),
                        Mock(),
                        storage,
                        discovered.reports[0],
                        amazon_scope="NA",
                        seller_namespace="seller",
                    )
                acquisition = cast(SettlementAcquisition, publish.call_args.args[1])
                payload = settlement_payload(acquisition)
                self.assertEqual(payload["api_metadata"], metadata)
                self.assertEqual(payload["marketplace_ids"], [])
                self.assertEqual(settlement_from_payload(payload), acquisition)
                self.assertEqual(
                    load_document_archive(storage, acquisition.document), b"unparsed source"
                )

    def test_data_kiosk_archives_whole_ordered_pages_without_jsonl_parsing(self) -> None:
        storage = MemoryArchiveStorage()
        pages = (
            page(1, terminal=False, content=b"\xef\xbb\xbfnot JSON\r\n"),
            page(2, terminal=True, content=b"\xff"),
        )
        with (
            patch(ACQUISITION_MODULE + ".iter_economics_document_pages", return_value=iter(pages)),
            patch(
                ACQUISITION_MODULE + ".persist_data_kiosk_acquisition", return_value="saved"
            ) as publish,
        ):
            download_kiosk_acquisition(storage)
        acquisition = cast(DataKioskAcquisition, publish.call_args.args[1])
        self.assertEqual(acquisition.root_query_id, "query-1")
        self.assertEqual(acquisition.root_query_created_at, CREATED)
        self.assertEqual(acquisition.id.version, 7)
        self.assertEqual(len(storage.objects), 2)
        self.assertEqual(data_kiosk_from_payload(data_kiosk_payload(acquisition)), acquisition)
        for original, saved in zip(pages, acquisition.pages, strict=True):
            self.assertIsNotNone(saved.document)
            if saved.document is not None:
                self.assertEqual(load_document_archive(storage, saved.document), original.document)

    def test_no_data_preserves_done_metadata_without_inventing_empty_file(self) -> None:
        storage = MemoryArchiveStorage()
        with (
            patch(
                ACQUISITION_MODULE + ".iter_economics_document_pages",
                return_value=iter([page(1, terminal=True, content=None)]),
            ),
            patch(ACQUISITION_MODULE + ".persist_data_kiosk_acquisition") as publish,
        ):
            download_kiosk_acquisition(storage)
        acquisition = cast(DataKioskAcquisition, publish.call_args.args[1])
        self.assertEqual(storage.objects, {})
        self.assertIsNone(acquisition.pages[0].document)
        self.assertEqual(acquisition.pages[0].api_metadata["processingStatus"], "DONE")

    def test_missing_source_time_and_incomplete_pagination_never_publish(self) -> None:
        for pages in (
            [
                DownloadedEconomicsPage(
                    page_number=1,
                    query_id="query",
                    document_kind=DataKioskDocumentKind.NO_DATA,
                    is_terminal=True,
                )
            ],
            [page(1, terminal=False, content=b"valid archive bytes")],
        ):
            with (
                self.subTest(pages=pages),
                patch(
                    ACQUISITION_MODULE + ".iter_economics_document_pages", return_value=iter(pages)
                ),
                patch(ACQUISITION_MODULE + ".persist_data_kiosk_acquisition") as publish,
                self.assertRaises(ValueError),
            ):
                download_kiosk_acquisition(MemoryArchiveStorage())
            publish.assert_not_called()

    def test_failed_upload_leaves_no_success_manifest(self) -> None:
        storage = Mock()
        storage.put.side_effect = OSError("upload failed")
        with (
            patch(
                ACQUISITION_MODULE + ".iter_economics_document_pages",
                return_value=iter([page(1, terminal=True, content=b"body")]),
            ),
            patch(ACQUISITION_MODULE + ".persist_data_kiosk_acquisition") as publish,
            self.assertRaises(OSError),
        ):
            download_kiosk_acquisition(storage)
        publish.assert_not_called()
