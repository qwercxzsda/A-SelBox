class ReportResponseError(RuntimeError):
    """Report an invalid or failed Reports API boundary without request details."""


class ReportDocumentDownloadError(RuntimeError):
    """Report a signed document transfer failure without retaining its URL."""


class ReportDocumentDecompressionError(RuntimeError):
    """Report an invalid source compression envelope before archival."""


__all__ = [
    "ReportDocumentDecompressionError",
    "ReportDocumentDownloadError",
    "ReportResponseError",
]
