"""Lossless XZ archives in private Supabase Storage, with no Amazon dependency."""

import hashlib
import logging
import lzma
from collections.abc import Mapping
from typing import TYPE_CHECKING, Protocol, cast
from urllib.parse import quote, urlsplit

import httpx

from .models import ArchivedDocument, archive_path

if TYPE_CHECKING:
    from .acquisition_logging import AcquisitionLog

SOURCE_ARCHIVE_BUCKET = "source-archives"


class ArchiveIntegrityError(ValueError):
    """Saved archive bytes or manifest integrity did not match."""


class ArchiveStorage(Protocol):
    """Minimal immutable object boundary for production and local verification."""

    def put(self, bucket: str, object_path: str, content: bytes) -> None:
        """Create the object without replacing an existing different object."""

    def get(self, bucket: str, object_path: str) -> bytes:
        """Read the complete object, failing when unavailable."""
        ...


class SupabaseArchiveStorage:
    """Authenticated private Storage transfers; never persist signed URLs or keys."""

    def __init__(
        self, url: str, service_key: str, *, transport: httpx.BaseTransport | None = None
    ) -> None:
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"https", "http"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or (
                parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            )
        ):
            raise ValueError("Supabase Storage requires HTTPS or a local development endpoint.")
        if not service_key.strip():
            raise ValueError("Supabase Storage requires a server-side service key.")
        self._url = url.rstrip("/")
        self._service_key = service_key
        self._transport = transport
        logging.getLogger("httpx").setLevel(logging.WARNING)
        logging.getLogger("httpcore").setLevel(logging.WARNING)

    def _request(self, method: str, path: str, *, content: bytes | None = None) -> httpx.Response:
        try:
            with httpx.Client(
                timeout=120.0,
                follow_redirects=False,
                trust_env=False,
                transport=self._transport,
                headers={
                    "apikey": self._service_key,
                    "Authorization": f"Bearer {self._service_key}",
                },
            ) as client:
                return client.request(
                    method,
                    self._url + "/storage/v1/" + path,
                    content=content,
                    headers={"Content-Type": "application/x-xz", "x-upsert": "false"},
                )
        except httpx.HTTPError:
            raise RuntimeError("Supabase archive transfer failed.") from None

    def _require_private_bucket(self, bucket: str) -> None:
        response = self._request("GET", "bucket/" + quote(archive_path(bucket), safe=""))
        if not response.is_success:
            raise RuntimeError("Supabase archive bucket is unavailable.")
        metadata: object = response.json()
        if (
            not isinstance(metadata, Mapping)
            or cast(Mapping[str, object], metadata).get("public") is not False
        ):
            raise ValueError("Source archives require a private Supabase Storage bucket.")

    def put(self, bucket: str, object_path: str, content: bytes) -> None:
        self._require_private_bucket(bucket)
        path = _object_location(bucket, object_path)
        response = self._request("POST", "object/" + path, content=content)
        existing = response.status_code in (400, 409)
        if not response.is_success and not existing:
            raise RuntimeError("Supabase archive upload failed.")
        # Both new uploads and retries must read back exactly the same bytes.
        if self.get(bucket, object_path) != content:
            if existing:
                raise ArchiveIntegrityError("An existing archive object has different bytes.")
            raise ArchiveIntegrityError("Uploaded archive failed read-back verification.")

    def get(self, bucket: str, object_path: str) -> bytes:
        self._require_private_bucket(bucket)
        response = self._request(
            "GET", "object/authenticated/" + _object_location(bucket, object_path)
        )
        if not response.is_success:
            raise RuntimeError("Saved archive object is missing or inaccessible.")
        return response.content


def _object_location(bucket: str, object_path: str) -> str:
    return quote(archive_path(bucket), safe="") + "/" + quote(archive_path(object_path), safe="/")


def archive_document(
    storage: ArchiveStorage,
    document_bytes: bytes,
    *,
    source_compression: str | None,
    acquisition_log: AcquisitionLog | None = None,
) -> ArchivedDocument:
    """Archive the exact already decompressed source bytes and verify before upload."""
    if type(document_bytes) is not bytes:
        raise TypeError("Only exact source document bytes can be archived.")
    archive_bytes = lzma.compress(
        document_bytes,
        format=lzma.FORMAT_XZ,
        preset=2 | lzma.PRESET_EXTREME,
        check=lzma.CHECK_CRC64,
    )
    document_hash = hashlib.sha256(document_bytes).hexdigest()
    archive_hash = hashlib.sha256(archive_bytes).hexdigest()
    manifest = ArchivedDocument(
        bucket=SOURCE_ARCHIVE_BUCKET,
        object_path=f"sha256/{archive_hash[:2]}/{archive_hash}.xz",
        document_sha256=document_hash,
        document_byte_length=len(document_bytes),
        archive_sha256=archive_hash,
        archive_byte_length=len(archive_bytes),
        source_compression=source_compression,
    )
    if _verify_archive(archive_bytes, manifest) != document_bytes:
        raise ArchiveIntegrityError("Archive compression did not preserve the original bytes.")
    if acquisition_log is not None:
        acquisition_log.upload_started(manifest)
    storage.put(manifest.bucket, manifest.object_path, archive_bytes)
    if acquisition_log is not None:
        acquisition_log.archive_verified()
    return manifest


def load_document_archive(storage: ArchiveStorage, document: ArchivedDocument) -> bytes:
    """Read and verify saved input locally; missing/corrupt input never triggers Amazon."""
    return _verify_archive(storage.get(document.bucket, document.object_path), document)


def _verify_archive(archive_bytes: bytes, manifest: ArchivedDocument) -> bytes:
    if (
        len(archive_bytes) != manifest.archive_byte_length
        or hashlib.sha256(archive_bytes).hexdigest() != manifest.archive_sha256
    ):
        raise ArchiveIntegrityError("Archive length or SHA-256 does not match its manifest.")
    try:
        decoder = lzma.LZMADecompressor(format=lzma.FORMAT_XZ)
        document = decoder.decompress(archive_bytes)
    except lzma.LZMAError:
        raise ArchiveIntegrityError("Saved XZ archive failed its integrity checks.") from None
    if decoder.check != lzma.CHECK_CRC64 or not decoder.eof or decoder.unused_data:
        raise ArchiveIntegrityError("Archive must be one complete XZ stream with CRC64.")
    if (
        len(document) != manifest.document_byte_length
        or hashlib.sha256(document).hexdigest() != manifest.document_sha256
    ):
        raise ArchiveIntegrityError(
            "Decoded document length or SHA-256 does not match its manifest."
        )
    return document
