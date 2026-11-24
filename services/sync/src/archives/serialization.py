"""Validated archive manifests for offline replay."""

from collections.abc import Mapping

from .models import ArchivedDocument


def document_from_payload(payload: Mapping[str, object]) -> ArchivedDocument:
    """Decode the archive manifest shared by all source acquisitions."""
    return ArchivedDocument(
        bucket=_string(payload["bucket"]),
        object_path=_string(payload["object_path"]),
        document_sha256=_string(payload["document_sha256"]),
        document_byte_length=_integer(payload["document_byte_length"]),
        archive_sha256=_string(payload["archive_sha256"]),
        archive_byte_length=_integer(payload["archive_byte_length"]),
        source_compression=_optional_string(payload["source_compression"]),
        archive_codec=_string(payload["archive_codec"]),
        archive_preset=_string(payload["archive_preset"]),
        archive_check=_string(payload["archive_check"]),
    )


def _string(value: object) -> str:
    """Decode text without inventing values or changing exact source identifiers."""
    if not isinstance(value, str):
        raise TypeError("Manifest text values must be strings.")
    return value


def _integer(value: object) -> int:
    if type(value) is not int:
        raise TypeError("Manifest length or page number must be an integer.")
    return value


def _optional_string(value: object) -> str | None:
    return None if value is None else _string(value)
