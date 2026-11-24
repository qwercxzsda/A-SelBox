"""Separate online acquisition and offline preprocessing command boundaries."""

import contextlib
import os
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import Mock, patch

from services.sync.src.cli import (
    common,
    download_finances,
    preprocess_finances,
)


class ArchiveCommandTests(unittest.TestCase):
    def test_finances_default_uses_three_calendar_months_without_an_upper_bound(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(download_finances, "datetime", wraps=datetime) as clock,
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
            manifest = Path(directory) / "capture.json"
            result = download_finances.main(
                ["--scope", "NA", "--manifest-output", str(manifest), "--no-load-dotenv"]
            )
        self.assertEqual(result, 0)
        download.assert_called_once()
        self.assertEqual(
            download.call_args.kwargs["posted_after"], datetime(2026, 8, 11, tzinfo=UTC)
        )
        self.assertIsNone(download.call_args.kwargs["posted_before"])
        save.assert_called_once_with(manifest, download.return_value)
        client_factory.return_value.close.assert_called_once()

    def test_finances_explicit_timestamp_bounds_do_not_read_the_database(self) -> None:
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(download_finances, "datetime", wraps=datetime) as clock,
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
        download.assert_called_once()
        self.assertEqual(
            download.call_args.kwargs["posted_after"], datetime(2026, 9, 11, tzinfo=UTC)
        )
        self.assertEqual(
            download.call_args.kwargs["posted_before"], datetime(2026, 11, 10, tzinfo=UTC)
        )

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
                parser = preprocess_finances.build_parser()
                arguments = ["saved"]
                common.initialize_cli(parser, arguments)
                self.assertEqual(os.environ["ASELBOX_TEST_SOURCE"], "service")
                self.assertEqual(os.environ["ASELBOX_TEST_PRESERVE"], "process")
                del os.environ["ASELBOX_TEST_SOURCE"]
                common.initialize_cli(parser, [*arguments, "--no-load-dotenv"])
                self.assertNotIn("ASELBOX_TEST_SOURCE", os.environ)
                (service / ".env").unlink()
                common.initialize_cli(parser, arguments)
                self.assertNotIn("ASELBOX_TEST_SOURCE", os.environ)
