import os
import unittest
from pathlib import Path
from unittest.mock import call, patch

import run_common
import run_download
import run_preprocess_no_sku_transactions
import run_preprocess_order_transactions
from src.test.fakes import FakeDatabaseConnection, make_preprocess_result


class TestRunFiles(unittest.TestCase):
    def test_download_settings_uses_defaults_and_endpoint_refresh_token(self) -> None:
        """Check that Step A owns defaults and resolves endpoint-specific tokens."""
        parser = run_download.build_parser()
        args = parser.parse_args(["--no-load-dotenv"])

        with patch.dict(os.environ, {"REFRESH_TOKEN_NA": "refresh-token"}, clear=False):
            settings = run_download.settings_from_args(args)

        self.assertEqual(settings.amz_endpoint, run_download.DEFAULT_AMZ_ENDPOINT)
        self.assertEqual(settings.db_address, run_download.DEFAULT_DB_ADDRESS)
        self.assertEqual(settings.refresh_token, "refresh-token")
        self.assertEqual(settings.days, run_download.DEFAULT_DAYS)
        self.assertIsNone(settings.output_dir)

    def test_download_run_passes_settings_to_sync(self) -> None:
        """Check that Step A builds clients and passes explicit sync settings."""
        settings = run_download.DownloadRunSettings(
            "EU",
            "postgresql://example.local/postgres",
            "refresh-token",
            3,
            Path("reports"),
        )

        with patch(
            "run_download.sync_settlement_reports",
            return_value=["settlement-id-1"],
        ) as sync_mock:
            inserted_settlement_ids = run_download.run(settings)

        self.assertEqual(inserted_settlement_ids, ["settlement-id-1"])
        sync_mock.assert_called_once()
        call_kwargs = sync_mock.call_args.kwargs
        self.assertEqual(call_kwargs["client_factory"].amazon_endpoint, "EU")
        self.assertEqual(call_kwargs["client_factory"].refresh_token, "refresh-token")
        self.assertEqual(call_kwargs["database"].database_url, settings.db_address)
        self.assertEqual(call_kwargs["days"], settings.days)
        self.assertEqual(call_kwargs["output_dir"], settings.output_dir)

    def test_order_preprocess_run_uses_selected_settlement_ids(self) -> None:
        """Check that Step B calls only order preprocessing."""
        settings = run_preprocess_order_transactions.OrderPreprocessRunSettings(
            "postgresql://example.local/postgres",
            ["settlement-id-1", "settlement-id-2"],
            False,
            "order-v2",
            "manual order run",
        )
        fake_database = FakeDatabaseConnection()

        with (
            patch(
                "run_preprocess_order_transactions.PostgresDatabaseConnection",
                return_value=fake_database,
            ) as database_class,
            patch(
                "run_preprocess_order_transactions.preprocess_order_transactions",
                side_effect=[
                    make_preprocess_result("settlement-id-1", "order-run-1", "order"),
                    make_preprocess_result("settlement-id-2", "order-run-2", "order"),
                ],
            ) as preprocess_mock,
        ):
            results = run_preprocess_order_transactions.run(settings)

        database_class.assert_called_once_with(settings.db_address)
        self.assertEqual(fake_database.enter_count, 1)
        self.assertEqual(fake_database.connection_count, 0)
        self.assertEqual([result.settlement_id for result in results], settings.settlement_ids)
        preprocess_mock.assert_has_calls(
            [
                call(
                    fake_database,
                    "settlement-id-1",
                    preprocess_version="order-v2",
                    preprocess_description="manual order run",
                ),
                call(
                    fake_database,
                    "settlement-id-2",
                    preprocess_version="order-v2",
                    preprocess_description="manual order run",
                ),
            ]
        )

    def test_no_sku_preprocess_run_uses_selected_settlement_ids(self) -> None:
        """Check that Step C calls only no-SKU preprocessing."""
        settings = run_preprocess_no_sku_transactions.NoSkuPreprocessRunSettings(
            "postgresql://example.local/postgres",
            ["settlement-id-1"],
            False,
            "no-sku-v2",
            "manual no-sku run",
        )
        fake_database = FakeDatabaseConnection()

        with (
            patch(
                "run_preprocess_no_sku_transactions.PostgresDatabaseConnection",
                return_value=fake_database,
            ) as database_class,
            patch(
                "run_preprocess_no_sku_transactions.preprocess_no_sku_transactions",
                return_value=make_preprocess_result(
                    "settlement-id-1",
                    "no-sku-run-1",
                    "no_sku",
                ),
            ) as preprocess_mock,
        ):
            results = run_preprocess_no_sku_transactions.run(settings)

        database_class.assert_called_once_with(settings.db_address)
        self.assertEqual(fake_database.enter_count, 1)
        self.assertEqual(fake_database.connection_count, 0)
        self.assertEqual([result.settlement_id for result in results], settings.settlement_ids)
        preprocess_mock.assert_called_once_with(
            fake_database,
            "settlement-id-1",
            preprocess_version="no-sku-v2",
            preprocess_description="manual no-sku run",
        )

    def test_settlement_selector_requires_explicit_or_all_settlements(self) -> None:
        """Check that preprocessing steps cannot silently run with no settlement IDs."""
        fake_database = FakeDatabaseConnection()

        with self.assertRaisesRegex(ValueError, "settlement-id"):
            run_common.get_selected_settlement_ids(fake_database, [], False)
        self.assertEqual(fake_database.connection_count, 0)


if __name__ == "__main__":
    unittest.main()
