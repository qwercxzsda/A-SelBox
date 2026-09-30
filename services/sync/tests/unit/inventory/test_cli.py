"""Inventory commands separate explicitly routed online work from archive replay."""

import unittest
from unittest.mock import Mock, patch

from services.sync.src.cli import download_inventory

from .fixtures import MARKETPLACE


class InventoryCommandTests(unittest.TestCase):
    def test_online_command_routes_explicit_credentials_and_closes_client(self) -> None:
        with (
            patch.object(download_inventory, "archive_storage_from_args", return_value=Mock()),
            patch.object(
                download_inventory, "load_lwa_credentials", return_value=Mock()
            ) as credentials,
            patch.object(
                download_inventory, "create_explicit_sp_api_client", return_value=Mock()
            ) as create,
            patch.object(download_inventory, "close_quietly") as close,
            patch.object(download_inventory, "PostgresDatabaseConnection"),
            patch.object(
                download_inventory, "download_inventory_acquisition", return_value="saved"
            ) as download,
        ):
            result = download_inventory.main(
                [
                    "--scope",
                    "NA",
                    "--seller-namespace",
                    "seller",
                    "--marketplace-id",
                    MARKETPLACE,
                    "--max-poll-attempts",
                    "5",
                    "--poll-interval-seconds",
                    "0",
                    "--report-id",
                    "report",
                    "--no-load-dotenv",
                ]
            )
        self.assertEqual(result, 0)
        credentials.assert_called_once_with("REFRESH_TOKEN_NA")
        self.assertIs(create.call_args.args[2], credentials.return_value)
        self.assertEqual(download.call_args.kwargs["max_poll_attempts"], 5)
        self.assertEqual(download.call_args.kwargs["marketplace_id"], MARKETPLACE)
        self.assertEqual(download.call_args.kwargs["report_id"], "report")
        close.assert_called_once_with(create.return_value)

    def test_scope_failure_precedes_credentials_and_database(self) -> None:
        with (
            patch.object(download_inventory, "load_lwa_credentials") as credentials,
            patch.object(download_inventory, "PostgresDatabaseConnection") as database,
            self.assertLogs(download_inventory.logger, level="ERROR"),
        ):
            result = download_inventory.main(
                [
                    "--scope",
                    "EU",
                    "--marketplace-id",
                    MARKETPLACE,
                    "--no-load-dotenv",
                ]
            )
        self.assertEqual(result, 1)
        credentials.assert_not_called()
        database.assert_not_called()
