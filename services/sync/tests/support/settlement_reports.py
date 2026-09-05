"""Shared Settlement report fixtures and Amazon Reports test doubles."""

from collections.abc import Mapping, Sequence

from ...src.amazon.reports.discovery import SETTLEMENT_REPORT_TYPE
from ...src.amazon.settlement_models import ParsedSettlementReport
from ...src.amazon.settlement_parser import parse_settlement_report


def make_report_text() -> str:
    """Return a small settlement TSV fixture with metadata and transaction rows."""
    headers = [
        "settlement-id",
        "settlement-start-date",
        "settlement-end-date",
        "deposit-date",
        "total-amount",
        "currency",
        "transaction-type",
        "order-id",
        "merchant-order-id",
        "adjustment-id",
        "shipment-id",
        "marketplace-name",
        "amount-type",
        "amount-description",
        "amount",
        "fulfillment-id",
        "posted-date",
        "posted-date-time",
        "order-item-code",
        "merchant-order-item-id",
        "merchant-adjustment-item-id",
        "sku",
        "quantity-purchased",
        "promotion-id",
    ]
    rows = [
        {
            "settlement-id": "26169742111",
            "settlement-start-date": "15.04.2026 06:33:36 UTC",
            "settlement-end-date": "29.04.2026 06:33:37 UTC",
            "deposit-date": "01.05.2026 06:33:37 UTC",
            "total-amount": "-58.54",
            "currency": "CAD",
        },
        {
            "settlement-id": "26169742111",
            "transaction-type": "other-transaction",
            "amount-type": "other-transaction",
            "amount-description": "Payable to Amazon",
            "amount": "-14.39",
            "posted-date": "15.04.2026",
            "posted-date-time": "15.04.2026 06:33:36 UTC",
        },
        {
            "settlement-id": "26169742111",
            "transaction-type": "Order",
            "order-id": "702-1234567-1234567",
            "merchant-order-id": "702-1234567-1234567",
            "shipment-id": "shipment-1",
            "marketplace-name": "Amazon.ca",
            "amount-type": "ItemPrice",
            "amount-description": "Principal",
            "amount": "10.00",
            "fulfillment-id": "AFN",
            "posted-date": "16.04.2026",
            "posted-date-time": "16.04.2026 00:10:00 UTC",
            "order-item-code": "order-item-1",
            "sku": "SKU-1",
            "quantity-purchased": "1",
        },
    ]
    return (
        "\n".join(
            [
                "\t".join(headers),
                *("\t".join(row.get(column, "") for column in headers) for row in rows),
            ]
        )
        + "\n"
    )


def make_report_bytes() -> bytes:
    """Return the small settlement TSV fixture as immutable UTF-8 bytes."""
    return make_report_text().encode()


def make_parsed_settlement_report() -> ParsedSettlementReport:
    """Build a lossless parsed settlement report for insert tests."""
    return parse_settlement_report(make_report_bytes())


class FakeResponse:
    def __init__(
        self,
        payload: dict[str, object],
        next_token: str | None,
    ) -> None:
        """Store the minimal ApiResponse fields used by pagination code."""
        self.payload = payload
        self.next_token = next_token
        self.rate_limit = None


class FakeClient:
    def __init__(
        self,
        report_text: str,
        reports: Sequence[Mapping[str, object]] | None = None,
        document_texts: dict[str, str] | None = None,
    ) -> None:
        """Create a fake Reports client that records API calls."""
        self.report_text = report_text
        source_reports = (
            reports
            if reports is not None
            else [
                {
                    "reportId": "report-1",
                    "reportDocumentId": "document-1",
                    "createdTime": "2026-08-20T12:34:56Z",
                }
            ]
        )
        self.reports = [
            {
                "reportType": SETTLEMENT_REPORT_TYPE,
                "processingStatus": "DONE",
                **report,
            }
            for report in source_reports
        ]
        self.document_texts = document_texts or {}
        self.get_reports_calls: list[dict[str, object]] = []
        self.downloads: list[str] = []
        self.closed = False

    def get_reports(self, **kwargs: object) -> FakeResponse:
        """Return one completed settlement report from the fake client."""
        self.get_reports_calls.append(kwargs)
        marketplace_ids = kwargs.get("marketplaceIds")
        return FakeResponse(
            {
                "reports": [
                    {
                        **report,
                        "marketplaceIds": report.get("marketplaceIds", marketplace_ids),
                    }
                    for report in self.reports
                ]
            },
            None,
        )

    def get_report_document(
        self,
        report_document_id: str,
    ) -> FakeResponse:
        """Return fake signed-download metadata for one report document."""
        self.downloads.append(report_document_id)
        return FakeResponse(
            {
                "reportDocumentId": report_document_id,
                "url": f"https://download.invalid/{report_document_id}",
            },
            None,
        )

    def download_document_bytes(self, document_url: str) -> bytes:
        """Return the fake report bytes addressed by a signed URL."""
        report_document_id: str = document_url.rsplit("/", maxsplit=1)[-1]
        document_text: str = self.document_texts.get(report_document_id, self.report_text)
        return document_text.encode()

    def close(self) -> None:
        """Record that the caller closed the fake Reports client."""
        self.closed = True


class FakePaginatedClient(FakeClient):
    def __init__(self, responses: list[FakeResponse]) -> None:
        """Return queued report-list pages while retaining download behavior."""
        super().__init__(make_report_text(), reports=[])
        self.responses = list(responses)

    def get_reports(self, **kwargs: object) -> FakeResponse:
        """Return the next queued page and record its exact request parameters."""
        self.get_reports_calls.append(kwargs)
        if not self.responses:
            raise AssertionError("No fake Reports page remains.")
        return self.responses.pop(0)
