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
    def test_manifest_round_trip_is_atomic_and_cannot_replace_another_capture(self) -> None:
        storage = MemoryArchiveStorage()
        first, second = finances_acquisition(storage), finances_acquisition(storage)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.json"
            write_finances_manifest(path, first)
            self.assertEqual(read_finances_manifest(path), first)
            self.assertEqual(json.loads(path.read_text())["id"], str(first.id))
            with self.assertRaises(FileExistsError):
                write_finances_manifest(path, second)
            self.assertEqual(read_finances_manifest(path), first)
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_manifest_requires_one_complete_acquisition_object(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.json"
            path.write_text("[]")
            with self.assertRaisesRegex(ValueError, "must be an object"):
                read_finances_manifest(path)
            path.write_text("{}")
            with self.assertRaises(KeyError):
                read_finances_manifest(path)

    def test_download_cli_writes_one_acquisition_manifest(self) -> None:
        acquisition = finances_acquisition(MemoryArchiveStorage())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.json"
            with (
                patch.object(download_finances, "load_lwa_credentials"),
                patch.object(
                    download_finances,
                    "fetch_financial_marketplace_ids",
                    return_value=("ATVPDKIKX0DER",),
                ),
                patch.object(download_finances, "archive_storage_from_args"),
                patch.object(download_finances, "FinancesHttpClient"),
                patch.object(
                    download_finances, "download_finances_acquisition", return_value=acquisition
                ),
            ):
                self.assertEqual(
                    download_finances.main(
                        [
                            "--posted-after",
                            "2026-09-11T00:00:00Z",
                            "--manifest-output",
                            str(path),
                            "--no-load-dotenv",
                        ]
                    ),
                    0,
                )
            self.assertEqual(read_finances_manifest(path), acquisition)

    def test_existing_download_manifest_fails_before_credentials_or_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.json"
            path.write_text("preserved")
            with patch.object(download_finances, "load_lwa_credentials") as credentials:
                result = download_finances.main(
                    [
                        "--posted-after",
                        "2026-08-01T00:00:00Z",
                        "--posted-before",
                        "2026-09-01T00:00:00Z",
                        "--manifest-output",
                        str(path),
                        "--no-load-dotenv",
                    ]
                )
            self.assertEqual(result, 1)
            self.assertEqual(path.read_text(), "preserved")
            credentials.assert_not_called()

    def test_offline_preprocessing_never_contacts_amazon(self) -> None:
        acquisition = finances_acquisition(MemoryArchiveStorage())
        with (
            patch.object(
                preprocess_finances, "read_finances_manifest", return_value=acquisition
            ) as read,
            patch.object(preprocess_finances, "archive_storage_from_args", return_value=Mock()),
            patch.object(preprocess_finances, "PostgresDatabaseConnection"),
            patch.object(
                preprocess_finances, "preprocess_finances_acquisition", return_value="run"
            ) as workflow,
        ):
            self.assertEqual(preprocess_finances.main(["capture.json", "--no-load-dotenv"]), 0)
        read.assert_called_once_with(Path("capture.json"))
        self.assertEqual(workflow.call_args.args[2], acquisition)
