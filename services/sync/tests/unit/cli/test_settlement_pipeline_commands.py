"""Tests for the two Settlement workflow command surfaces."""

import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import UUID, uuid4

from ....src.amazon.credentials import AmazonLwaCredentials
from ....src.amazon.fba_reports.lifecycle import FbaReportFailedError, FbaReportPollingTimeoutError
from ....src.amazon.sellers_participations import MarketplaceParticipation
from ....src.cli import download_and_parse_settlement_reports as download_command
from ....src.cli import process_settlement_report as process_command
from ....src.numeric import NumericBoundError
from ....src.settlement_processing.acquisition import AuxiliaryAcquisitionSettings, AuxiliaryClients
from ....src.settlement_processing.artifacts import ProcessingArtifactLog
from ....src.settlement_processing.ledger_entry_builder import UnrecognizedMarketplaceError
from ....src.settlement_processing.models import AuxiliaryRequirements, SettlementProcessingResult
from ....src.settlement_processing.raw_report import prepare_settlement_report
from ....src.settlements.download_and_parse import SettlementDownloadAndParseResult
from ...support.fakes import FakeDatabaseConnection
from ...support.settlement_processing import stored_settlement_report

SETTLEMENT_REPORT_ID = str(UUID(int=1))
PROCESSING_LOG_ID = str(UUID(int=2))
MARKETPLACE_ID = "ATVPDKIKX0DER"


def _download_result(**overrides: int) -> SettlementDownloadAndParseResult:
    values = {
        "listed_count": 1,
        "inserted_count": 1,
        "already_stored_count": 0,
        "identity_anomaly_count": 0,
        "download_failed_count": 0,
        "parse_failed_count": 0,
        "persistence_failed_count": 0,
    }
    values.update(overrides)
    return SettlementDownloadAndParseResult(**values)


class TestDownloadAndParseSettlementReportsCommand(unittest.TestCase):
    def test_settings_repr_redacts_database_url(self) -> None:
        settings = download_command.SettlementDownloadAndParseSettings(
            amazon_scope="NA",
            database_url="postgresql://private.local/postgres",
        )

        self.assertNotIn(settings.database_url, repr(settings))

    def test_run_uses_participating_marketplace_names_and_closes_client(self) -> None:
        settings = download_command.SettlementDownloadAndParseSettings(
            amazon_scope="NA",
            database_url="postgresql://localhost/postgres",
            seller_namespace="seller-na",
        )
        credentials = AmazonLwaCredentials("app", "secret", "refresh")
        participation = MarketplaceParticipation(MARKETPLACE_ID, "US", "amazon.com")
        client = Mock()
        database = FakeDatabaseConnection()
        expected = _download_result()

        with (
            patch.object(download_command, "load_lwa_credentials", return_value=credentials),
            patch.object(
                download_command,
                "fetch_marketplace_participations",
                return_value=(participation,),
            ),
            patch.object(download_command, "create_reports_client", return_value=client),
            patch.object(
                download_command,
                "PostgresDatabaseConnection",
                return_value=database,
            ),
            patch.object(
                download_command,
                "download_and_parse_settlement_reports",
                return_value=expected,
            ) as download_and_parse,
        ):
            result = download_command.run(settings)

        self.assertIs(result, expected)
        download_and_parse.assert_called_once_with(
            client,
            database,
            amazon_scope="NA",
            marketplace_ids=(MARKETPLACE_ID,),
            marketplace_names_by_id={MARKETPLACE_ID: "US"},
            seller_namespace="seller-na",
        )
        client.close.assert_called_once_with()

    def test_main_returns_nonzero_for_an_identity_anomaly(self) -> None:
        incomplete = _download_result(inserted_count=0, identity_anomaly_count=1)

        with patch.object(download_command, "run", return_value=incomplete):
            exit_code = download_command.main(["--no-load-dotenv"])

        self.assertEqual(exit_code, 1)


class TestProcessSettlementReportCommand(unittest.TestCase):
    def test_no_auxiliary_requirement_does_not_load_credentials(self) -> None:
        settlement = prepare_settlement_report(
            stored_settlement_report(), id_factory=lambda: str(uuid4())
        )
        requirements = AuxiliaryRequirements()
        artifacts = ProcessingArtifactLog(Path("unused-artifacts"))
        settings = AuxiliaryAcquisitionSettings()

        with (
            patch.object(process_command, "load_lwa_credentials") as load_credentials,
            patch.object(process_command, "create_data_kiosk_client") as create_data_kiosk,
            patch.object(process_command, "create_reports_client") as create_reports,
            patch.object(
                process_command, "acquire_auxiliary_observations", return_value=()
            ) as acquire,
        ):
            result = process_command._load_auxiliary(  # pyright: ignore[reportPrivateUsage]
                settlement, requirements, artifacts, settings=settings
            )

        self.assertEqual(result, ())
        load_credentials.assert_not_called()
        create_data_kiosk.assert_not_called()
        create_reports.assert_not_called()
        acquire.assert_called_once_with(
            settlement, requirements, AuxiliaryClients(), artifacts, settings
        )

    def test_auxiliary_client_closes_when_second_client_creation_fails(self) -> None:
        settlement = prepare_settlement_report(
            stored_settlement_report(), id_factory=lambda: str(uuid4())
        )
        client = Mock()
        with (
            patch.object(
                process_command,
                "load_lwa_credentials",
                return_value=AmazonLwaCredentials("app", "secret", "refresh"),
            ),
            patch.object(process_command, "create_data_kiosk_client", return_value=client),
            patch.object(
                process_command, "create_reports_client", side_effect=RuntimeError("setup failed")
            ),
            patch.object(process_command, "acquire_auxiliary_observations") as acquire,
            self.assertRaisesRegex(RuntimeError, "setup failed"),
        ):
            process_command._load_auxiliary(  # pyright: ignore[reportPrivateUsage]
                settlement,
                AuxiliaryRequirements(data_kiosk=True, fba_removal=True),
                ProcessingArtifactLog(Path("unused-artifacts")),
                settings=AuxiliaryAcquisitionSettings(),
            )

        client.close.assert_called_once_with()
        acquire.assert_not_called()

    def test_explicit_report_id_is_a_reprocessing_override(self) -> None:
        settings = process_command.settings_from_args(
            process_command.build_parser().parse_args(
                [
                    "--no-load-dotenv",
                    "--settlement-report-id",
                    SETTLEMENT_REPORT_ID,
                    "--artifact-root",
                    "output/test-processing",
                ]
            )
        )

        self.assertEqual(settings.settlement_report_id, SETTLEMENT_REPORT_ID)
        self.assertEqual(settings.artifact_root, Path("output/test-processing"))

    def test_main_succeeds_when_there_is_no_unprocessed_report(self) -> None:
        result = SettlementProcessingResult(
            settlement_report_id=None,
            processing_log_id=None,
            no_unprocessed_report=True,
        )

        with patch.object(process_command, "run", return_value=result):
            exit_code = process_command.main(["--no-load-dotenv"])

        self.assertEqual(exit_code, 0)

    def test_main_reports_processing_failure_without_sensitive_details(self) -> None:
        with (
            patch.object(
                process_command,
                "run",
                side_effect=RuntimeError("private document detail"),
            ),
            self.assertLogs(process_command.logger.name, level="ERROR") as captured,
        ):
            exit_code = process_command.main(["--no-load-dotenv"])

        self.assertEqual(exit_code, 1)
        logs = "\n".join(captured.output)
        self.assertIn("RuntimeError", logs)
        self.assertNotIn("private document detail", logs)

    def test_main_logs_a_specific_range_error_without_the_financial_value(self) -> None:
        private_amount = "1000000000000000001"
        error = NumericBoundError(f"Amount {private_amount} exceeds its numeric bound.")

        with (
            patch.object(process_command, "run", side_effect=error),
            self.assertLogs(process_command.logger.name, level="ERROR") as captured,
        ):
            exit_code = process_command.main(["--no-load-dotenv"])

        self.assertEqual(exit_code, 1)
        self.assertEqual(len(captured.records), 1)
        logs = "\n".join(captured.output)
        self.assertIn("NUMERIC_BOUND_EXCEEDED", logs)
        self.assertNotIn(private_amount, logs)
        self.assertNotIn("SETTLEMENT_PROCESSING_FAILED", logs)

    def test_unrecognized_marketplace_aborts_with_a_safe_source_line_error(self) -> None:
        error = UnrecognizedMarketplaceError(4)
        error.args = ("private document detail",)

        with (
            patch.object(process_command, "run", side_effect=error),
            self.assertLogs(process_command.logger.name, level="ERROR") as captured,
        ):
            exit_code = process_command.main(["--no-load-dotenv"])

        self.assertEqual(exit_code, 1)
        self.assertEqual(len(captured.records), 1)
        self.assertIn("UNRECOGNIZED_MARKETPLACE", captured.output[0])
        self.assertIn("source_line=4", captured.output[0])
        self.assertNotIn("private document detail", captured.output[0])
        self.assertNotIn("SETTLEMENT_PROCESSING_FAILED", captured.output[0])

    def test_fba_failures_return_once_with_actionable_safe_logs(self) -> None:
        for error, expected_details in (
            (
                FbaReportPollingTimeoutError("private report details"),
                ("FBA_REPORT_POLL_TIMEOUT", "360 polls", "10.0-second", "--max-poll-attempts"),
            ),
            (FbaReportFailedError("FATAL"), ("FBA_REPORT_FAILED", "status=FATAL")),
            (FbaReportFailedError("CANCELLED"), ("FBA_REPORT_FAILED", "status=CANCELLED")),
        ):
            with (
                self.subTest(error=type(error).__name__, details=expected_details),
                patch.object(process_command, "run", side_effect=error) as run,
                self.assertLogs(process_command.logger.name, level="ERROR") as captured,
            ):
                exit_code = process_command.main(
                    [
                        "--no-load-dotenv",
                        "--max-poll-attempts",
                        "360",
                        "--poll-interval-seconds",
                        "10",
                    ]
                )
            self.assertEqual(exit_code, 1)
            run.assert_called_once()
            self.assertEqual(len(captured.records), 1)
            for detail in expected_details:
                self.assertIn(detail, captured.output[0])
            self.assertNotIn("private report details", captured.output[0])

    def test_main_succeeds_for_an_inserted_processing_run(self) -> None:
        result = SettlementProcessingResult(
            settlement_report_id=SETTLEMENT_REPORT_ID,
            processing_log_id=PROCESSING_LOG_ID,
            processed_entry_count=2,
            processed_result_count=1,
        )

        with patch.object(process_command, "run", return_value=result):
            exit_code = process_command.main(["--no-load-dotenv"])

        self.assertEqual(exit_code, 0)


if __name__ == "__main__":
    unittest.main()
