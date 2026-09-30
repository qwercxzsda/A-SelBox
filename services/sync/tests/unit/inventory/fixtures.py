"""Synthetic inventory documents and explicit API boundary fakes."""

import csv
import io
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import uuid7

from services.sync.src.archives.storage import archive_document
from services.sync.src.inventory.models import INVENTORY_REPORT_TYPE, InventoryAcquisition
from services.sync.tests.support.archives import MemoryArchiveStorage

MARKETPLACE = "ATVPDKIKX0DER"


def report_bytes(*rows: Mapping[str, str], columns: tuple[str, ...] | None = None) -> bytes:
    fields = columns or tuple(dict.fromkeys(key for row in rows for key in row))
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter="\t", lineterminator="\n")
    writer.writerow(fields)
    writer.writerows([row.get(key, "") for key in fields] for row in rows)
    return output.getvalue().encode("utf-8")


def saved_acquisition(content: bytes, storage: MemoryArchiveStorage) -> InventoryAcquisition:
    return InventoryAcquisition(
        id=uuid7(),
        seller_namespace="seller",
        amazon_scope="NA",
        marketplace_id=MARKETPLACE,
        marketplace_name="Amazon.com",
        capture_date=date(2026, 9, 28),
        report_id="report",
        report_document_id="document",
        report_created_at=datetime(2026, 9, 29, 6, 59, tzinfo=UTC),
        downloaded_at=datetime(2026, 9, 29, 8, tzinfo=UTC),
        document=archive_document(storage, content, source_compression=None),
        api_metadata={"capture_timezone": "America/Los_Angeles"},
    )


@dataclass
class Response:
    payload: object


def report_summary(**changes: object) -> dict[str, object]:
    return {
        "reportId": "report",
        "reportDocumentId": "document",
        "reportType": INVENTORY_REPORT_TYPE,
        "processingStatus": "DONE",
        "createdTime": "2026-09-29T06:59:00Z",
        "marketplaceIds": [MARKETPLACE],
        **changes,
    }


class ReportsClient:
    def __init__(self, *summaries: Mapping[str, object]) -> None:
        self.summaries = iter(summaries or [report_summary()])
        self.create_calls: list[dict[str, object]] = []
        self.polls = 0

    def create_report(self, **kwargs: object) -> Response:
        self.create_calls.append(kwargs)
        return Response({"reportId": "report"})

    def get_report(self, report_id: str, /) -> Response:
        if report_id != "report":
            raise AssertionError("Unexpected report request.")
        self.polls += 1
        return Response(dict(next(self.summaries)))

    def get_report_document(self, report_document_id: str, /) -> Response:
        if report_document_id != "document":
            raise AssertionError("Unexpected document request.")
        return Response({"reportDocumentId": "document", "url": "https://example.com/private"})
