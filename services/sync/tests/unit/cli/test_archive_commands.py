"""Separate online acquisition and offline preprocessing command boundaries."""

import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from services.sync.src.cli import (
    common,
    download_data_kiosk,
    preprocess_data_kiosk,
    preprocess_settlement,
)


class ArchiveCommandTests(unittest.TestCase):
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

    def test_offline_commands_require_saved_identity_and_reject_scope_overrides(self) -> None:
        for command in (preprocess_data_kiosk, preprocess_settlement):
            for arguments in (
                [],
                ["--acquisition-id", "saved", "--scope", "EU"],
                ["--acquisition-id", "saved", "--seller-namespace", "other-seller"],
            ):
                with (
                    self.subTest(command=command.__name__, arguments=arguments),
                    contextlib.redirect_stderr(io.StringIO()),
                    self.assertRaises(SystemExit) as failure,
                ):
                    command.build_parser().parse_args(arguments)
                self.assertEqual(failure.exception.code, 2)

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

    def test_all_offline_commands_call_only_archive_preprocessors(self) -> None:
        cases = (
            (preprocess_settlement, "preprocess_settlement_acquisition"),
            (preprocess_data_kiosk, "preprocess_data_kiosk_acquisition"),
        )
        for command, function_name in cases:
            with (
                self.subTest(command=command.__name__),
                patch.object(command, "archive_storage_from_args", return_value=Mock()) as storage,
                patch.object(command, "PostgresDatabaseConnection") as database,
                patch.object(command, function_name, return_value="new-success") as preprocess,
                patch(
                    "services.sync.src.amazon.credentials.load_lwa_credentials",
                    side_effect=AssertionError("Offline command touched Amazon credentials"),
                ),
            ):
                self.assertEqual(command.main(["--acquisition-id", "saved", "--no-load-dotenv"]), 0)
                self.assertEqual(
                    preprocess.call_args.args,
                    (database.return_value.__enter__.return_value, storage.return_value, "saved"),
                )

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

    def test_reviewed_retrocharge_coverage_keeps_exact_source_lines(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "coverage.json"
            path.write_text("[[2,4],[7,8]]", encoding="utf-8")
            self.assertEqual(
                preprocess_settlement.read_retrocharge_coverage(path), ((2, 4), (7, 8))
            )
            path.write_text("[[true,4]]", encoding="utf-8")
            with self.assertRaises(ValueError):
                preprocess_settlement.read_retrocharge_coverage(path)
