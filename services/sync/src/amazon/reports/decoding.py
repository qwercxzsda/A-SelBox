"""Pure decoding for report bodies already available in local storage."""

import gzip
import zlib
from contextlib import suppress

from .errors import ReportDocumentDecompressionError
from .models import DownloadedReportDocument


def decompress_report_document(document: DownloadedReportDocument) -> bytes:
    """Decode a transferred report body without contacting Amazon."""
    if document.compression_algorithm is None:
        return document.transferred_content
    decompressed_document: bytes | None = None
    with suppress(OSError, EOFError, zlib.error):
        decompressed_document = gzip.decompress(document.transferred_content)
    if decompressed_document is None:
        raise ReportDocumentDecompressionError(
            "The retained Reports document is not valid GZIP content."
        )
    return decompressed_document


__all__ = ["decompress_report_document"]
