"""Lossless Data Kiosk body decompression at the acquisition boundary."""

import gzip
import zlib

from .errors import DataKioskDocumentError


def decompress_data_kiosk_document(document: bytes) -> tuple[bytes, str | None]:
    """Remove the optional gzip envelope while checking its checksum and length.

    Data Kiosk getDocument has no compressionAlgorithm field. The gzip signature
    identifies the returned envelope; there is no text decoding or JSON parsing.
    """
    if not document.startswith(b"\x1f\x8b"):
        return document, None
    try:
        return gzip.decompress(document), "GZIP"
    except EOFError, OSError, zlib.error:
        raise DataKioskDocumentError("The gzip Data Kiosk document is invalid.") from None
