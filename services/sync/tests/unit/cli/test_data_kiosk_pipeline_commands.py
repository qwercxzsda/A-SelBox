"""Tests for the single rolling Data Kiosk provision command."""

import unittest
from dataclasses import replace
from datetime import UTC, date, datetime
from unittest.mock import Mock, patch
from uuid import UUID

from ....src.amazon.credentials import AmazonLwaCredentials
from ....src.amazon.data_kiosk.client_protocol import DataKioskClient
from ....src.amazon.sellers_participations import MarketplaceParticipation
from ....src.cli import refresh_data_kiosk_provision as command
from ....src.data_kiosk_economics.acquisition import MarketplaceProvisionData
from ....src.database.connection import DatabaseConnection
from ....src.database.data_kiosk_economics.models import (
    DataKioskProvisionPersistenceResult,
    DataKioskProvisionRefresh,
)
from ...support.fakes import FakeDatabaseConnection

US_MARKETPLACE_ID = "ATVPDKIKX0DER"
CA_MARKETPLACE_ID = "A2EUQ1WTGCTBG2"
NOW = datetime(2026, 9, 2, 12, tzinfo=UTC)
PROCESSING_LOG_ID = str(UUID(int=1))


def _window(marketplace_id: str) -> command.MarketplaceQueryWindow:
    return command.MarketplaceQueryWindow(
        marketplace_id,
        date(2026, 8, 1),
        date(2026, 8, 2),
    )


def _settings(
    marketplace_ids: tuple[str, ...] = (US_MARKETPLACE_ID, CA_MARKETPLACE_ID),
) -> command.RefreshDataKioskProvisionSettings:
    return command.RefreshDataKioskProvisionSettings(
        amazon_scope="NA",
        database_url="postgresql://localhost/postgres",
        seller_namespace="seller-na",
        marketplace_windows=tuple(_window(value) for value in marketplace_ids),
        max_pages=3,
        max_poll_attempts=4,
        poll_interval_seconds=0,
    )


def _participation(marketplace_id: str) -> MarketplaceParticipation:
    return MarketplaceParticipation(marketplace_id, "Country", "example.invalid")


class TestRefreshDataKioskProvisionSettings(unittest.TestCase):
    def test_resolves_complete_marketplace_local_dates(self) -> None:
        args = command.build_parser().parse_args(
            ["--no-load-dotenv", "--scope", "NA", "--marketplace-id", US_MARKETPLACE_ID]
        )

        settings = command.settings_from_args(args, now=NOW)

        self.assertEqual(settings.amazon_scope, "NA")
        self.assertFalse(settings.use_active_scope_marketplaces)
        self.assertEqual(len(settings.marketplace_windows), 1)
        window = settings.marketplace_windows[0]
        self.assertEqual(window.marketplace_id, US_MARKETPLACE_ID)
        self.assertEqual(window.end_date, date(2026, 9, 1))
        self.assertEqual((window.end_date - window.start_date).days + 1, 60)

    def test_rejects_partial_explicit_date_windows(self) -> None:
        args = command.build_parser().parse_args(
            [
                "--no-load-dotenv",
                "--scope",
                "NA",
                "--marketplace-id",
                US_MARKETPLACE_ID,
                "--start-date",
                "2026-08-01",
            ]
        )

        with self.assertRaisesRegex(ValueError, "both --start-date and --end-date"):
            command.settings_from_args(args, now=NOW)


class TestRefreshDataKioskProvisionRun(unittest.TestCase):
    def test_all_marketplaces_finish_in_memory_before_the_database_opens(self) -> None:
        settings = _settings()
        credentials = AmazonLwaCredentials("app", "secret", "refresh")
        client = Mock()
        database = FakeDatabaseConnection()
        expected = DataKioskProvisionPersistenceResult(PROCESSING_LOG_ID, 2, 0)
        events: list[str] = []

        def download(
            _client: DataKioskClient,
            *,
            marketplace_id: str,
            query_start_date: date,
            query_end_date: date,
            **_limits: object,
        ) -> MarketplaceProvisionData:
            events.append(f"download:{marketplace_id}")
            return MarketplaceProvisionData(
                marketplace_id=marketplace_id,
                query_start_date=query_start_date,
                query_end_date=query_end_date,
                facts=(),
            )

        def open_database(_database_url: str) -> FakeDatabaseConnection:
            events.append("open-database")
            return database

        def persist_provision(
            actual_database: DatabaseConnection,
            refresh: DataKioskProvisionRefresh,
        ) -> DataKioskProvisionPersistenceResult:
            events.append("persist")
            self.assertIs(actual_database, database)
            self.assertEqual(
                refresh.marketplace_ids,
                (US_MARKETPLACE_ID, CA_MARKETPLACE_ID),
            )
            self.assertEqual(refresh.facts, ())
            return expected

        with (
            patch.object(command, "load_lwa_credentials", return_value=credentials),
            patch.object(
                command,
                "fetch_marketplace_participations",
                return_value=(
                    _participation(US_MARKETPLACE_ID),
                    _participation(CA_MARKETPLACE_ID),
                ),
            ),
            patch.object(command, "create_data_kiosk_client", return_value=client),
            patch.object(
                command,
                "download_and_process_data_kiosk_provision",
                side_effect=download,
            ) as acquire,
            patch.object(
                command,
                "PostgresDatabaseConnection",
                side_effect=open_database,
            ),
            patch.object(
                command,
                "persist_data_kiosk_provisions",
                side_effect=persist_provision,
            ),
        ):
            result = command.run(settings, now=lambda: NOW)

        self.assertIs(result, expected)
        self.assertEqual(
            events,
            [
                f"download:{US_MARKETPLACE_ID}",
                f"download:{CA_MARKETPLACE_ID}",
                "open-database",
                "persist",
            ],
        )
        self.assertEqual(acquire.call_count, 2)
        self.assertEqual(acquire.call_args_list[0].kwargs["max_pages"], 3)
        self.assertEqual(acquire.call_args_list[0].kwargs["max_poll_attempts"], 4)
        client.close.assert_called_once_with()

    def test_default_scope_records_empty_results_for_inactive_marketplaces(self) -> None:
        settings = replace(_settings(), use_active_scope_marketplaces=True)
        credentials = AmazonLwaCredentials("app", "secret", "refresh")
        client = Mock()
        database = FakeDatabaseConnection()
        expected = DataKioskProvisionPersistenceResult(PROCESSING_LOG_ID, 2, 0)

        def persist_provision(
            _database: DatabaseConnection,
            refresh: DataKioskProvisionRefresh,
        ) -> DataKioskProvisionPersistenceResult:
            self.assertEqual(
                refresh.marketplace_ids,
                (US_MARKETPLACE_ID, CA_MARKETPLACE_ID),
            )
            return expected

        with (
            patch.object(command, "load_lwa_credentials", return_value=credentials),
            patch.object(
                command,
                "fetch_marketplace_participations",
                return_value=(_participation(US_MARKETPLACE_ID),),
            ),
            patch.object(command, "create_data_kiosk_client", return_value=client),
            patch.object(
                command,
                "download_and_process_data_kiosk_provision",
                return_value=MarketplaceProvisionData(
                    marketplace_id=US_MARKETPLACE_ID,
                    query_start_date=date(2026, 8, 1),
                    query_end_date=date(2026, 8, 2),
                    facts=(),
                ),
            ) as acquire,
            patch.object(command, "PostgresDatabaseConnection", return_value=database),
            patch.object(
                command,
                "persist_data_kiosk_provisions",
                side_effect=persist_provision,
            ),
        ):
            result = command.run(settings, now=lambda: NOW)

        self.assertIs(result, expected)
        acquire.assert_called_once()

    def test_acquisition_failure_never_opens_the_database(self) -> None:
        settings = _settings()
        credentials = AmazonLwaCredentials("app", "secret", "refresh")
        client = Mock()
        first_result = MarketplaceProvisionData(
            marketplace_id=US_MARKETPLACE_ID,
            query_start_date=date(2026, 8, 1),
            query_end_date=date(2026, 8, 2),
            facts=(),
        )

        with (
            patch.object(command, "load_lwa_credentials", return_value=credentials),
            patch.object(
                command,
                "fetch_marketplace_participations",
                return_value=(
                    _participation(US_MARKETPLACE_ID),
                    _participation(CA_MARKETPLACE_ID),
                ),
            ),
            patch.object(command, "create_data_kiosk_client", return_value=client),
            patch.object(
                command,
                "download_and_process_data_kiosk_provision",
                side_effect=(first_result, RuntimeError("bad second marketplace")),
            ),
            patch.object(command, "PostgresDatabaseConnection") as open_database,
            self.assertRaisesRegex(RuntimeError, "bad second marketplace"),
        ):
            command.run(settings, now=lambda: NOW)

        open_database.assert_not_called()
        client.close.assert_called_once_with()

    def test_main_redacts_refresh_failure_details(self) -> None:
        with (
            patch.object(command, "run", side_effect=RuntimeError("credential detail")),
            self.assertLogs(command.logger.name, level="ERROR") as captured,
        ):
            exit_code = command.main(
                [
                    "--no-load-dotenv",
                    "--scope",
                    "NA",
                    "--marketplace-id",
                    US_MARKETPLACE_ID,
                ]
            )

        self.assertEqual(exit_code, 1)
        logs = "\n".join(captured.output)
        self.assertIn("RuntimeError", logs)
        self.assertNotIn("credential detail", logs)

    def test_main_reports_the_committed_processing_log_id(self) -> None:
        result = DataKioskProvisionPersistenceResult(PROCESSING_LOG_ID, 1, 2)
        with (
            patch.object(command, "run", return_value=result),
            self.assertLogs(command.logger.name, level="INFO") as captured,
        ):
            exit_code = command.main(
                ["--no-load-dotenv", "--scope", "NA", "--marketplace-id", US_MARKETPLACE_ID]
            )

        self.assertEqual(exit_code, 0)
        self.assertIn(f"process={PROCESSING_LOG_ID}", "\n".join(captured.output))


if __name__ == "__main__":
    unittest.main()
