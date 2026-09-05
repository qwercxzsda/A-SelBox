"""Process one Settlement report with transient Amazon elaboration inputs."""

import argparse
import logging
from collections.abc import Sequence
from contextlib import ExitStack
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path

from ..amazon.client import create_data_kiosk_client, create_reports_client
from ..amazon.credentials import close_quietly, load_lwa_credentials
from ..amazon.fba_reports.lifecycle import FbaReportFailedError, FbaReportPollingTimeoutError
from ..amazon.marketplaces import get_credential_scope
from ..amazon.transport import suppress_sensitive_transport_logging
from ..database.connection import PostgresDatabaseConnection
from ..database.seller_namespaces import validate_seller_namespace
from ..database.values import normalize_uuid, required_text
from ..numeric import NumericBoundError
from ..settlement_processing.acquisition import (
    DEFAULT_MAX_POLL_ATTEMPTS,
    DEFAULT_POLL_INTERVAL_SECONDS,
    DEFAULT_REMOVAL_ORDER_LOOKBACK_DAYS,
    AuxiliaryAcquisitionSettings,
    AuxiliaryClients,
    acquire_auxiliary_observations,
)
from ..settlement_processing.artifacts import ProcessingArtifactLog
from ..settlement_processing.ledger_entry_builder import UnrecognizedMarketplaceError
from ..settlement_processing.models import (
    PROCESSOR_VERSION,
    AuxiliaryFeeObservation,
    AuxiliaryRequirements,
    PreparedSettlement,
    SettlementProcessingResult,
)
from ..settlement_processing.workflow import process_settlement_report
from .common import (
    add_log_and_env_arguments,
    add_storage_arguments,
    initialize_cli,
    non_negative_float,
    positive_int,
)

DEFAULT_ARTIFACT_ROOT = Path("output/settlement-processing")

logger = logging.getLogger("run_process_settlement_report")


@dataclass(frozen=True, slots=True)
class ProcessSettlementReportSettings:
    database_url: str = field(repr=False)
    seller_namespace: str
    settlement_report_id: str | None
    artifact_root: Path
    processor_version: str = PROCESSOR_VERSION
    acquisition: AuxiliaryAcquisitionSettings = field(default_factory=AuxiliaryAcquisitionSettings)

    def __post_init__(self) -> None:
        if not self.database_url.strip():
            raise ValueError("Database URL must not be blank.")
        object.__setattr__(
            self,
            "seller_namespace",
            validate_seller_namespace(self.seller_namespace),
        )
        if self.settlement_report_id is not None:
            object.__setattr__(
                self,
                "settlement_report_id",
                normalize_uuid(self.settlement_report_id, "settlement_report_id"),
            )
        object.__setattr__(
            self,
            "processor_version",
            required_text(self.processor_version, "processor_version"),
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Process the oldest unprocessed Settlement report, fetching required "
            "Data Kiosk/FBA inputs transiently."
        )
    )
    add_storage_arguments(parser)
    parser.add_argument(
        "--settlement-report-id",
        help=(
            "Explicit database UUID to process again; otherwise selects the oldest "
            "unprocessed report."
        ),
    )
    parser.add_argument(
        "--artifact-root",
        type=Path,
        default=DEFAULT_ARTIFACT_ROOT,
        help="Local directory for fetched inputs and pre-commit diagnostic metadata.",
    )
    parser.add_argument("--processor-version", default=PROCESSOR_VERSION)
    parser.add_argument(
        "--max-poll-attempts",
        type=positive_int,
        default=DEFAULT_MAX_POLL_ATTEMPTS,
    )
    parser.add_argument(
        "--poll-interval-seconds",
        type=non_negative_float,
        default=DEFAULT_POLL_INTERVAL_SECONDS,
    )
    parser.add_argument(
        "--removal-order-lookback-days",
        type=positive_int,
        default=DEFAULT_REMOVAL_ORDER_LOOKBACK_DAYS,
    )
    add_log_and_env_arguments(parser)
    return parser


def settings_from_args(args: argparse.Namespace) -> ProcessSettlementReportSettings:
    return ProcessSettlementReportSettings(
        database_url=args.database_url,
        seller_namespace=args.seller_namespace,
        settlement_report_id=args.settlement_report_id,
        artifact_root=args.artifact_root,
        processor_version=args.processor_version,
        acquisition=AuxiliaryAcquisitionSettings(
            max_poll_attempts=args.max_poll_attempts,
            poll_interval_seconds=args.poll_interval_seconds,
            removal_order_lookback_days=args.removal_order_lookback_days,
        ),
    )


def run(settings: ProcessSettlementReportSettings) -> SettlementProcessingResult:
    suppress_sensitive_transport_logging()
    with PostgresDatabaseConnection(settings.database_url) as database:
        return process_settlement_report(
            database,
            partial(_load_auxiliary, settings=settings.acquisition),
            seller_namespace=settings.seller_namespace,
            artifact_root=settings.artifact_root,
            settlement_report_id=settings.settlement_report_id,
            processor_version=settings.processor_version,
        )


def _load_auxiliary(
    settlement: PreparedSettlement,
    requirements: AuxiliaryRequirements,
    artifacts: ProcessingArtifactLog,
    *,
    settings: AuxiliaryAcquisitionSettings,
) -> tuple[AuxiliaryFeeObservation, ...]:
    """Create only required clients and close each even if later setup fails."""
    with ExitStack() as clients:
        data_kiosk_client = None
        reports_client = None
        if requirements.any:
            credential_scope = get_credential_scope(settlement.header.amazon_scope)
            credentials = load_lwa_credentials(credential_scope.refresh_token_environment)
            if requirements.data_kiosk:
                data_kiosk_client = create_data_kiosk_client(
                    credential_scope.client_marketplace, credentials
                )
                clients.callback(close_quietly, data_kiosk_client)
            if requirements.fba_aged_storage or requirements.fba_removal:
                reports_client = create_reports_client(settlement.header.amazon_scope, credentials)
                clients.callback(close_quietly, reports_client)
        return acquire_auxiliary_observations(
            settlement,
            requirements,
            AuxiliaryClients(data_kiosk=data_kiosk_client, reports=reports_client),
            artifacts,
            settings,
        )


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    try:
        result = run(settings_from_args(args))
    except NumericBoundError:
        logger.error("Settlement processing failed [code=NUMERIC_BOUND_EXCEEDED].")
        return 1
    except UnrecognizedMarketplaceError as error:
        logger.error(
            "Settlement processing aborted: unrecognized marketplace-name "
            "[code=UNRECOGNIZED_MARKETPLACE, source_line=%s].",
            error.source_line_number,
        )
        return 1
    except FbaReportPollingTimeoutError:
        logger.error(
            "FBA report is still pending after %s polls at %s-second intervals "
            "[code=FBA_REPORT_POLL_TIMEOUT]. Increase --max-poll-attempts or "
            "--poll-interval-seconds for a later run.",
            args.max_poll_attempts,
            args.poll_interval_seconds,
        )
        return 1
    except FbaReportFailedError as error:
        logger.error(
            "FBA report processing ended [code=FBA_REPORT_FAILED, status=%s].",
            error.processing_status,
        )
        return 1
    except Exception as error:
        logger.error(
            "Settlement processing failed [code=SETTLEMENT_PROCESSING_FAILED, exception_type=%s].",
            type(error).__name__,
        )
        return 1
    if result.no_unprocessed_report:
        logger.info("No unprocessed Settlement report was found.")
        return 0
    logger.info(
        "Settlement processing finished. entries=%s results=%s",
        result.processed_entry_count,
        result.processed_result_count,
    )
    return 0


__all__ = [
    "ProcessSettlementReportSettings",
    "build_parser",
    "main",
    "run",
    "settings_from_args",
]
