"""Separate online acquisition and offline preprocessing command boundaries."""

import contextlib
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, date, datetime
from pathlib import Path
from unittest.mock import Mock, patch

from services.sync.src.cli import (
    common,
    download_data_kiosk,
    download_finances,
    preprocess_data_kiosk,
)


class ArchiveCommandTests(unittest.TestCase):
    def test_finances_default_uses_database_cutoff_without_an_upper_bound(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(download_finances, "datetime", wraps=datetime) as clock,
            patch.object(download_finances, "PostgresDatabaseConnection") as database_factory,
            patch.object(download_finances, "load_lwa_credentials", return_value=Mock()),
            patch.object(download_finances, "FinancesHttpClient") as client_factory,
            patch.object(
                download_finances,
                "fetch_financial_marketplace_ids",
                return_value=("ATVPDKIKX0DER",),
            ),
            patch.object(download_finances, "archive_storage_from_args", return_value=Mock()),
            patch.object(download_finances, "download_finances_acquisition") as download,
            patch.object(download_finances, "write_finances_manifest") as save,
        ):
            clock.now.return_value = datetime(2026, 11, 11, 2, tzinfo=UTC)
            database = database_factory.return_value.__enter__.return_value
            connection = database.connection.return_value.__enter__.return_value
            connection.execute.return_value.fetchone.return_value = (date(2026, 9, 11),)
            manifest = Path(directory) / "capture.json"
            result = download_finances.main(
                ["--scope", "NA", "--manifest-output", str(manifest), "--no-load-dotenv"]
            )
        self.assertEqual(result, 0)
        connection.execute.assert_called_once_with("select private.mature_cutoff_date()")
        download.assert_called_once()
        self.assertEqual(
            download.call_args.kwargs["posted_after"], datetime(2026, 9, 11, tzinfo=UTC)
        )
        self.assertIsNone(download.call_args.kwargs["posted_before"])
        save.assert_called_once_with(manifest, download.return_value)
        client_factory.return_value.close.assert_called_once()

    def test_finances_explicit_timestamp_bounds_do_not_read_the_database(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(download_finances, "datetime", wraps=datetime) as clock,
            patch.object(download_finances, "PostgresDatabaseConnection") as database_factory,
            patch.object(download_finances, "load_lwa_credentials", return_value=Mock()),
            patch.object(download_finances, "FinancesHttpClient", return_value=Mock()),
            patch.object(download_finances, "archive_storage_from_args", return_value=Mock()),
            patch.object(download_finances, "download_finances_acquisition") as download,
            patch.object(download_finances, "write_finances_manifest"),
        ):
            clock.now.return_value = datetime(2026, 11, 11, 2, tzinfo=UTC)
            result = download_finances.main(
                [
                    "--scope",
                    "NA",
                    "--marketplace-id",
                    "ATVPDKIKX0DER",
                    "--posted-after",
                    "2026-09-11T09:00:00+09:00",
                    "--posted-before",
                    "2026-11-10T00:00:00Z",
                    "--manifest-output",
                    str(Path(directory) / "capture.json"),
                    "--no-load-dotenv",
                ]
            )
        self.assertEqual(result, 0)
        database_factory.assert_not_called()
        download.assert_called_once()
        self.assertEqual(
            download.call_args.kwargs["posted_after"], datetime(2026, 9, 11, tzinfo=UTC)
        )
        self.assertEqual(
            download.call_args.kwargs["posted_before"], datetime(2026, 11, 10, tzinfo=UTC)
        )

    def test_finances_missing_cutoff_fails_before_amazon_access(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(download_finances, "PostgresDatabaseConnection") as database_factory,
            patch.object(download_finances, "load_lwa_credentials") as credentials,
            patch.object(download_finances, "FinancesHttpClient") as client,
            self.assertLogs(download_finances.__name__, level="ERROR"),
        ):
            database = database_factory.return_value.__enter__.return_value
            connection = database.connection.return_value.__enter__.return_value
            connection.execute.return_value.fetchone.return_value = None
            result = download_finances.main(
                [
                    "--manifest-output",
                    str(Path(directory) / "capture.json"),
                    "--no-load-dotenv",
                ]
            )
        self.assertEqual(result, 1)
        credentials.assert_not_called()
        client.assert_not_called()

    def test_module_entry_point_preserves_failed_workflow_exit_status(self) -> None:
        # The reversed date range fails before credentials, Amazon, or DB access.
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "services.sync.src.cli.download_data_kiosk",
                "--marketplace-id",
                "ATVPDKIKX0DER",
                "--start-date",
                "2026-08-31",
                "--end-date",
                "2026-08-01",
                "--no-load-dotenv",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("failed", result.stderr)

    def test_configuration_uses_service_file_and_preserves_process_environment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            service = root / "services" / "sync"
            cli_file = service / "src" / "cli" / "common.py"
            cli_file.parent.mkdir(parents=True)
            (root / ".env").write_text("ASELBOX_TEST_SOURCE=wrong-file\n", encoding="utf-8")
            (service / ".env").write_text(
                "ASELBOX_TEST_SOURCE=service\nASELBOX_TEST_PRESERVE=file\n", encoding="utf-8"
            )
            with (
                contextlib.chdir(root),
                patch.object(common, "__file__", str(cli_file)),
                patch.dict(os.environ, {"ASELBOX_TEST_PRESERVE": "process"}),
            ):
                os.environ.pop("ASELBOX_TEST_SOURCE", None)
                parser = preprocess_data_kiosk.build_parser()
                arguments = ["--acquisition-id", "saved"]
                common.initialize_cli(parser, arguments)
                self.assertEqual(os.environ["ASELBOX_TEST_SOURCE"], "service")
                self.assertEqual(os.environ["ASELBOX_TEST_PRESERVE"], "process")
                del os.environ["ASELBOX_TEST_SOURCE"]
                common.initialize_cli(parser, [*arguments, "--no-load-dotenv"])
                self.assertNotIn("ASELBOX_TEST_SOURCE", os.environ)
                (service / ".env").unlink()
                common.initialize_cli(parser, arguments)
                self.assertNotIn("ASELBOX_TEST_SOURCE", os.environ)

    def test_reversed_download_window_fails_before_amazon_or_database_access(self) -> None:
        with (
            patch.object(download_data_kiosk, "archive_storage_from_args"),
            patch.object(download_data_kiosk, "load_lwa_credentials") as credentials,
            patch.object(download_data_kiosk, "PostgresDatabaseConnection") as database,
            self.assertLogs(download_data_kiosk.logger, level="ERROR"),
        ):
            result = download_data_kiosk.main(
                [
                    "--marketplace-id",
                    "ATVPDKIKX0DER",
                    "--start-date",
                    "2026-08-31",
                    "--end-date",
                    "2026-08-01",
                    "--no-load-dotenv",
                ]
            )
        self.assertEqual(result, 1)
        credentials.assert_not_called()
        database.assert_not_called()

    def test_missing_archive_failure_does_not_call_amazon(self) -> None:
        with (
            patch.object(preprocess_data_kiosk, "archive_storage_from_args", return_value=Mock()),
            patch.object(preprocess_data_kiosk, "PostgresDatabaseConnection"),
            patch.object(
                preprocess_data_kiosk,
                "preprocess_data_kiosk_acquisition",
                side_effect=LookupError("missing saved source"),
            ),
            patch(
                "services.sync.src.amazon.credentials.load_lwa_credentials",
                side_effect=AssertionError("Must remain offline"),
            ),
        ):
            self.assertEqual(
                preprocess_data_kiosk.main(["--acquisition-id", "missing", "--no-load-dotenv"]), 1
            )
