from typing import Literal, NotRequired, Protocol, TypedDict


class ReportsPage(Protocol):
    @property
    def payload(self) -> object: ...

    @property
    def next_token(self) -> object: ...


class ReportDocumentMetadata(TypedDict):
    reportDocumentId: str
    url: str
    compressionAlgorithm: NotRequired[Literal["GZIP"]]


class ReportDocumentMetadataResponse(Protocol):
    @property
    def payload(self) -> object: ...


class ReportDocumentClient(Protocol):
    """Narrow typed view of the report-document SDK operation."""

    def get_report_document(
        self,
        report_document_id: str,
        /,
    ) -> ReportDocumentMetadataResponse:
        """Fetch metadata for one report document."""
        ...


class ReportsListClient(Protocol):
    """Reports API surface used to list report jobs."""

    def get_reports(self, **kwargs: object) -> ReportsPage:
        """List report jobs."""
        ...


class SettlementReportsClient(ReportsListClient, ReportDocumentClient, Protocol):
    """Reports API surface used by complete Settlement acquisition."""
