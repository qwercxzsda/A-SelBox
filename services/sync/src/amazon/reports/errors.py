class ReportResponseError(RuntimeError):
    """Report an invalid or failed Reports API boundary without request details."""


class ReportDocumentDownloadError(RuntimeError):
    """Report a signed document transfer failure without retaining its URL."""


class ReportDocumentDecompressionError(RuntimeError):
    """Report a retained document that cannot be decompressed for processing."""


__all__ = [
    "ReportDocumentDecompressionError",
    "ReportDocumentDownloadError",
    "ReportResponseError",
]
