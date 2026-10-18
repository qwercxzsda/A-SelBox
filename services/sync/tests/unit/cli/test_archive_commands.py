"""Separate online acquisition and offline preprocessing command boundaries."""

import contextlib
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from services.sync.src.cli import (
    common,
    download_data_kiosk,
    preprocess_data_kiosk,
)


class ArchiveCommandTests(unittest.TestCase):
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
