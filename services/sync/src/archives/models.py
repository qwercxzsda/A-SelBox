"""Validated manifests shared by acquisition and offline preprocessing."""

import re
from dataclasses import dataclass
from pathlib import PurePosixPath

from ..canonical_values import validate_sha256

SOURCE_ARCHIVE_BUCKET = "source-archives"
_ARCHIVE_OBJECT_PATH = re.compile(r"^[A-Za-z0-9_/-]+[.]xz$")
_MAX_ARCHIVE_LENGTH = 9223372036854775807


def archive_path(value: str) -> str:
    """Require a relative object path without URL or traversal syntax."""
    if (
        not value
        or value != value.strip()
        or value.startswith("/")
        or ":" in value
        or "\\" in value
        or any(part in {"", ".", ".."} for part in value.split("/"))
        or str(PurePosixPath(value)) != value
    ):
        raise ValueError("Archive location must be a canonical relative object path.")
    return value


@dataclass(frozen=True, slots=True, kw_only=True)
class ArchivedDocument:
    """Stable object location and independent source/archive integrity evidence."""

    bucket: str
    object_path: str
    document_sha256: str
    document_byte_length: int
    archive_sha256: str
    archive_byte_length: int
    source_compression: str | None
    archive_codec: str = "xz"
    archive_preset: str = "2e"
    archive_check: str = "CRC64"

    def __post_init__(self) -> None:
        if self.bucket != SOURCE_ARCHIVE_BUCKET:
            raise ValueError("Source archives require the private source-archives bucket.")
        archive_path(self.object_path)
        if not _ARCHIVE_OBJECT_PATH.fullmatch(self.object_path):
            raise ValueError("Archive object must use a canonical ASCII .xz key.")
        validate_sha256(self.document_sha256, "document_sha256")
        validate_sha256(self.archive_sha256, "archive_sha256")
        for length in (self.document_byte_length, self.archive_byte_length):
            if type(length) is not int or not 0 <= length <= _MAX_ARCHIVE_LENGTH:
                raise ValueError("Archive and document lengths must be nonnegative bigint values.")
        if self.archive_byte_length == 0:
            raise ValueError("A complete XZ archive cannot be empty.")
        if (self.archive_codec, self.archive_preset, self.archive_check) != ("xz", "2e", "CRC64"):
            raise ValueError("Source archives must use XZ 2e with CRC64.")
        if self.source_compression not in (None, "GZIP"):
            raise ValueError("Unsupported source compression declaration.")
