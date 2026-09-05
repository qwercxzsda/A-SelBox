class DataKioskHelperError(RuntimeError):
    """Base error for validated Data Kiosk helper operations."""


class DataKioskResponseError(DataKioskHelperError):
    """Indicate that Amazon returned an incomplete or inconsistent response."""

    def __init__(
        self,
        message: str,
        *,
        diagnostic_code: str = "DATA_KIOSK_RESPONSE_CONTRACT",
    ) -> None:
        self.diagnostic_code = diagnostic_code
        super().__init__(message)


class DataKioskPollingTimeoutError(DataKioskHelperError):
    """Indicate that a query did not finish within the configured poll bound."""


class DataKioskPaginationLimitError(DataKioskHelperError):
    """Indicate that result traversal reached its bound before exhausting pages."""


class DataKioskQueryFailedError(DataKioskHelperError):
    """Describe a terminal query failure without exposing query or document contents."""

    def __init__(
        self,
        query_id: str,
        processing_status: str,
        error_document_id: str | None,
    ) -> None:
        self.query_id = query_id
        self.processing_status = processing_status
        self.error_document_id = error_document_id

        super().__init__(f"Data Kiosk query ended with status {processing_status}.")


class DataKioskDocumentError(DataKioskHelperError):
    """Indicate that retained Data Kiosk document bytes are invalid."""


class DataKioskErrorDocumentError(DataKioskHelperError):
    """Indicate that Amazon returned a validated, schema-opaque error document."""

    def __init__(self) -> None:
        super().__init__("Data Kiosk returned an error document.")


class DataKioskEconomicsNormalizationError(DataKioskDocumentError):
    """Indicate that an Economics row cannot become typed fee evidence."""


__all__ = [
    "DataKioskDocumentError",
    "DataKioskEconomicsNormalizationError",
    "DataKioskErrorDocumentError",
    "DataKioskPaginationLimitError",
    "DataKioskPollingTimeoutError",
    "DataKioskQueryFailedError",
    "DataKioskResponseError",
]
