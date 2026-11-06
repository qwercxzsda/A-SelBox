"""Download manifests support offline replay before any database acceptance."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from services.sync.src.cli import download_finances, preprocess_finances
from services.sync.src.finances.manifests import read_finances_manifest, write_finances_manifest
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.finances import finances_acquisition


class ManifestTests(unittest.TestCase):
    def test_bundle_round_trip_and_atomic_extension_preserve_completed_captures(self) -> None:
        storage = MemoryArchiveStorage()
        first, second = finances_acquisition(storage), finances_acquisition(storage)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.json"
            write_finances_manifest(path, (first,))
            self.assertEqual(read_finances_manifest(path), (first,))
            write_finances_manifest(path, (first, second))
            self.assertEqual(read_finances_manifest(path), (first, second))
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_duplicate_manifest_identity_is_rejected(self) -> None:
        acquisition = finances_acquisition(MemoryArchiveStorage())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.json"
            write_finances_manifest(path, (acquisition, acquisition))
            with self.assertRaisesRegex(ValueError, "repeats"):
                read_finances_manifest(path)
            path.write_text(json.dumps({"format_version": 2, "acquisitions": []}))
            with self.assertRaisesRegex(ValueError, "Unsupported"):
                read_finances_manifest(path)

    def test_cli_consumes_manifest_path_and_download_has_no_database_argument(self) -> None:
        args = preprocess_finances.build_parser().parse_args(["capture.json"])
        self.assertEqual(args.manifest, Path("capture.json"))
        args = download_finances.build_parser().parse_args(
            [
                "--start-date",
                "2026-08-01",
                "--end-date",
                "2026-08-31",
                "--manifest-output",
                "capture.json",
            ]
        )
        self.assertFalse(hasattr(args, "database_url"))

    def test_existing_download_manifest_fails_before_credentials_or_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.json"
            path.write_text("preserved")
            with patch.object(download_finances, "load_lwa_credentials") as credentials:
                result = download_finances.main(
                    [
                        "--start-date",
                        "2026-08-01",
                        "--end-date",
                        "2026-08-31",
                        "--manifest-output",
                        str(path),
                        "--no-load-dotenv",
                    ]
                )
            self.assertEqual(result, 1)
            self.assertEqual(path.read_text(), "preserved")
            credentials.assert_not_called()

    def test_offline_preprocessing_never_contacts_amazon(self) -> None:
        with (
            patch.object(preprocess_finances, "archive_storage_from_args", return_value=Mock()),
            patch.object(preprocess_finances, "PostgresDatabaseConnection"),
            patch.object(
                preprocess_finances, "preprocess_finances_manifest", return_value=("run",)
            ) as workflow,
        ):
            self.assertEqual(preprocess_finances.main(["capture.json", "--no-load-dotenv"]), 0)
        self.assertEqual(workflow.call_args.args[2], Path("capture.json"))
