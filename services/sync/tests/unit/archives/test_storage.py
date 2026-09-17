"""Archive preservation, corruption rejection, and immutable private upload checks."""

import hashlib
import lzma
import unittest
from dataclasses import replace
from unittest.mock import patch

import httpx

from services.sync.src.archives.storage import (
    ArchiveIntegrityError,
    SupabaseArchiveStorage,
    archive_document,
    load_document_archive,
)
from services.sync.tests.support.archives import MemoryArchiveStorage


class ArchiveStorageTests(unittest.TestCase):
    def test_exact_xz_2e_crc64_bytes_and_independent_hashes(self) -> None:
        storage = MemoryArchiveStorage()
        original = b"\xef\xbb\xbf  not even TSV\r\n\x00\xff\xfe\n\t\t"
        with patch(
            "services.sync.src.archives.storage.lzma.compress", wraps=lzma.compress
        ) as compress:
            manifest = archive_document(storage, original, source_compression="GZIP")
        compress.assert_called_once_with(
            original, format=lzma.FORMAT_XZ, preset=2 | lzma.PRESET_EXTREME, check=lzma.CHECK_CRC64
        )
        saved = storage.get(manifest.bucket, manifest.object_path)
        self.assertEqual(load_document_archive(storage, manifest), original)
        self.assertEqual(manifest.document_sha256, hashlib.sha256(original).hexdigest())
        self.assertEqual(manifest.archive_sha256, hashlib.sha256(saved).hexdigest())
        self.assertNotEqual(manifest.document_sha256, manifest.archive_sha256)
        self.assertEqual(manifest.source_compression, "GZIP")

    def test_corruption_and_false_document_evidence_fail_offline(self) -> None:
        storage = MemoryArchiveStorage()
        manifest = archive_document(storage, b"source", source_compression=None)
        with self.assertRaises(ArchiveIntegrityError):
            load_document_archive(storage, replace(manifest, document_sha256="0" * 64))
        saved = storage.get(manifest.bucket, manifest.object_path)
        storage.objects[manifest.bucket, manifest.object_path] = saved[:-1] + b"!"
        with self.assertRaises(ArchiveIntegrityError):
            load_document_archive(storage, manifest)
        del storage.objects[manifest.bucket, manifest.object_path]
        with self.assertRaises(KeyError):
            load_document_archive(storage, manifest)

    def test_other_checks_and_concatenated_streams_are_rejected(self) -> None:
        storage = MemoryArchiveStorage()
        manifest = archive_document(storage, b"source", source_compression=None)
        for saved in (
            lzma.compress(b"source", check=lzma.CHECK_CRC32),
            storage.get(manifest.bucket, manifest.object_path) * 2,
        ):
            with self.subTest(saved_length=len(saved)):
                storage.objects[manifest.bucket, manifest.object_path] = saved
                altered = replace(
                    manifest,
                    archive_sha256=hashlib.sha256(saved).hexdigest(),
                    archive_byte_length=len(saved),
                )
                with self.assertRaises(ArchiveIntegrityError):
                    load_document_archive(storage, altered)

    def test_crc64_is_verified_even_when_archive_sha_matches_corruption(self) -> None:
        storage = MemoryArchiveStorage()
        manifest = archive_document(storage, b"source bytes" * 50, source_compression=None)
        saved = bytearray(storage.get(manifest.bucket, manifest.object_path))
        saved[len(saved) // 2] ^= 1
        corrupted = bytes(saved)
        storage.objects[manifest.bucket, manifest.object_path] = corrupted
        altered = replace(manifest, archive_sha256=hashlib.sha256(corrupted).hexdigest())
        with self.assertRaises(ArchiveIntegrityError):
            load_document_archive(storage, altered)

    def test_private_supabase_upload_and_identical_retry(self) -> None:
        objects: dict[str, bytes] = {}
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            self.assertEqual(request.headers["apikey"], "test-service-key")
            if "/bucket/" in request.url.path:
                return httpx.Response(200, json={"public": False})
            key = request.url.path.replace("/authenticated/", "/")
            if request.method == "POST":
                self.assertEqual(request.headers["x-upsert"], "false")
                if key in objects:
                    return httpx.Response(409)
                objects[key] = request.content
                return httpx.Response(200, json={"Key": key})
            return httpx.Response(200, content=objects[key])

        storage = SupabaseArchiveStorage(
            "http://127.0.0.1:54321", "test-service-key", transport=httpx.MockTransport(respond)
        )
        manifest = archive_document(storage, b"immutable original", source_compression=None)
        repeated = archive_document(storage, b"immutable original", source_compression=None)
        self.assertEqual(manifest, repeated)
        self.assertEqual(len(objects), 1)
        self.assertEqual(load_document_archive(storage, manifest), b"immutable original")
        self.assertTrue(any("/object/authenticated/" in request.url.path for request in requests))

    def test_public_bucket_is_rejected_before_upload(self) -> None:
        def respond(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"public": True})

        storage = SupabaseArchiveStorage(
            "https://example.supabase.co",
            "test-service-key",
            transport=httpx.MockTransport(respond),
        )
        with self.assertRaisesRegex(ValueError, "private"):
            archive_document(storage, b"sensitive", source_compression=None)

    def test_remote_plain_http_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            SupabaseArchiveStorage("http://example.com", "test-service-key")

    def test_changed_or_unreadable_uploaded_object_cannot_return_a_manifest(self) -> None:
        for upload_status, read_status in ((200, 200), (400, 200), (409, 200), (200, 404)):

            def respond(
                request: httpx.Request,
                upload_status: int = upload_status,
                read_status: int = read_status,
            ) -> httpx.Response:
                if "/bucket/" in request.url.path:
                    return httpx.Response(200, json={"public": False})
                if request.method == "POST":
                    return httpx.Response(upload_status)
                return httpx.Response(read_status, content=b"different stored bytes")

            storage = SupabaseArchiveStorage(
                "https://example.supabase.co",
                "test-service-key",
                transport=httpx.MockTransport(respond),
            )
            with (
                self.subTest(upload_status=upload_status, read_status=read_status),
                self.assertRaises(ArchiveIntegrityError if read_status == 200 else RuntimeError),
            ):
                archive_document(storage, b"original source", source_compression=None)
