"""Private Storage credentials stay bound to the explicit or verified local API."""

import argparse
import os
import subprocess
import unittest
from unittest.mock import patch

from services.sync.src.cli.archive_common import archive_storage_from_args


class ArchiveConfigTests(unittest.TestCase):
    def test_cli_credentials_are_used_only_for_the_exact_local_api(self) -> None:
        local = "http://127.0.0.1:54321"
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("services.sync.src.cli.archive_common.subprocess.run") as status,
            patch("services.sync.src.cli.archive_common.SupabaseArchiveStorage") as client,
        ):
            status.return_value.stdout = (
                '{"API_URL":"http://127.0.0.1:54321","SERVICE_ROLE_KEY":"test-key"}'
            )
            archive_storage_from_args(argparse.Namespace(supabase_url=None))
            client.assert_called_once_with(local, "test-key")
            self.assertEqual(
                status.call_args.args[0][0:4], ["supabase", "status", "--output", "json"]
            )
            self.assertTrue(status.call_args.kwargs["capture_output"])
            for url in (
                "http://127.0.0.1:54323",
                "https://project.example",
                "http://user@127.0.0.1:54321",
            ):
                with self.subTest(url=url), self.assertRaises(ValueError):
                    archive_storage_from_args(argparse.Namespace(supabase_url=url))
            self.assertEqual(status.call_count, 2)
            self.assertEqual(client.call_count, 1)

    def test_explicit_keys_do_not_require_a_local_stack(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "SUPABASE_URL": "https://project.example",
                    "SUPABASE_SERVICE_ROLE_KEY": "configured",
                },
                clear=True,
            ),
            patch("services.sync.src.cli.archive_common.subprocess.run") as status,
            patch("services.sync.src.cli.archive_common.SupabaseArchiveStorage") as client,
        ):
            archive_storage_from_args(argparse.Namespace(supabase_url=None))
            status.assert_not_called()
            client.assert_called_once_with("https://project.example", "configured")

    def test_status_failure_never_exposes_credential_bearing_output(self) -> None:
        with (
            patch.dict(os.environ, {}, clear=True),
            patch(
                "services.sync.src.cli.archive_common.subprocess.run",
                side_effect=subprocess.CalledProcessError(1, ["supabase"], output="secret-output"),
            ),
            self.assertRaisesRegex(RuntimeError, "^Unable to read the local Supabase status.$"),
        ):
            archive_storage_from_args(argparse.Namespace(supabase_url=None))
