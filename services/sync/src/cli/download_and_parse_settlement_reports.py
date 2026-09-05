"""Download, simple-parse, and atomically store successful Settlement reports."""

import argparse
import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import cast

from ..amazon.client import create_reports_client  # pyright: ignore[reportUnknownVariableType]
from ..amazon.credentials import close_quietly, load_lwa_credentials
from ..amazon.marketplaces import get_credential_scope
from ..amazon.reports.sdk_types import SettlementReportsClient
from ..amazon.scopes import DEFAULT_AMAZON_SCOPE, validate_amazon_scope
from ..amazon.sellers_participations import fetch_marketplace_participations
from ..amazon.transport import suppress_sensitive_transport_logging
from ..database.connection import PostgresDatabaseConnection
from ..database.seller_namespaces import (
    DEFAULT_SELLER_NAMESPACE,
    validate_seller_namespace,
)
from ..settlements.download_and_parse import (
    SettlementDownloadAndParseResult,
    download_and_parse_settlement_reports,
)
from .common import (
    add_log_and_env_arguments,
    add_storage_arguments,
    initialize_cli,
)

logger: logging.Logger = logging.getLogger("run_download_and_parse_settlement_reports")


@dataclass(frozen=True, slots=True)
class SettlementDownloadAndParseSettings:
    """Validated Settlement download-and-parse settings."""

    amazon_scope: str
    database_url: str = field(repr=False)
    seller_namespace: str = DEFAULT_SELLER_NAMESPACE

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "amazon_scope",
            validate_amazon_scope(self.amazon_scope),
        )
        object.__setattr__(
            self,
            "seller_namespace",
            validate_seller_namespace(self.seller_namespace),
        )
        if not self.database_url.strip():
            raise ValueError("Database URL must not be blank.")


def build_parser() -> argparse.ArgumentParser:
    """Build the Settlement download-and-parse parser."""
    parser = argparse.ArgumentParser(
        description=("Discover, download, parse, and atomically store Amazon Settlement reports."),
    )
    parser.add_argument(
        "--scope",
        default=DEFAULT_AMAZON_SCOPE,
        dest="amazon_scope",
        help="Named Amazon refresh-token/report provenance scope.",
    )
    add_storage_arguments(parser)
    add_log_and_env_arguments(parser)
    return parser


def settings_from_args(args: argparse.Namespace) -> SettlementDownloadAndParseSettings:
    """Convert parsed CLI arguments into validated settings."""
    return SettlementDownloadAndParseSettings(
        amazon_scope=args.amazon_scope,
        database_url=args.database_url,
        seller_namespace=args.seller_namespace,
    )


def run(settings: SettlementDownloadAndParseSettings) -> SettlementDownloadAndParseResult:
    """Discover and atomically store only successfully parsed reports."""
    suppress_sensitive_transport_logging()
    credential_scope = get_credential_scope(settings.amazon_scope)
    credentials = load_lwa_credentials(credential_scope.refresh_token_environment)
    participations = fetch_marketplace_participations(credential_scope, credentials)
    if not participations:
        raise RuntimeError("The selected Amazon scope has no active marketplace participation.")

    marketplace_names_by_id = {
        participation.marketplace_id: participation.name for participation in participations
    }
    marketplace_ids = tuple(marketplace_names_by_id)
    client: SettlementReportsClient | None = None
    try:
        client = cast(
            SettlementReportsClient,
            create_reports_client(settings.amazon_scope, credentials),
        )
        with PostgresDatabaseConnection(settings.database_url) as database:
            return download_and_parse_settlement_reports(
                client,
                database,
                amazon_scope=settings.amazon_scope,
                marketplace_ids=marketplace_ids,
                marketplace_names_by_id=marketplace_names_by_id,
                seller_namespace=settings.seller_namespace,
            )
    finally:
        close_quietly(client)


def main(argv: Sequence[str] | None = None) -> int:
    """Run the Settlement download-and-parse command."""
    args = initialize_cli(build_parser(), argv)
    try:
        settings = settings_from_args(args)
        result = run(settings)
    except Exception as error:
        logger.error(
            "Settlement download-and-parse failed "
            "[code=SETTLEMENT_DOWNLOAD_AND_PARSE_FAILED, exception_type=%s].",
            type(error).__name__,
        )
        return 1

    metrics = {
        "listed_count": result.listed_count,
        "inserted_count": result.inserted_count,
        "already_stored_count": result.already_stored_count,
        "identity_anomaly_count": result.identity_anomaly_count,
        "failed_download_count": result.download_failed_count,
        "failed_parse_count": result.parse_failed_count,
        "failed_persistence_count": result.persistence_failed_count,
    }
    incomplete = result.failed_count > 0
    logger.log(
        logging.ERROR if incomplete else logging.INFO,
        "Settlement download-and-parse finished "
        "[listed=%(listed_count)s, inserted=%(inserted_count)s, "
        "already_stored=%(already_stored_count)s, "
        "identity_anomalies=%(identity_anomaly_count)s, "
        "failed_downloads=%(failed_download_count)s, "
        "failed_parses=%(failed_parse_count)s, "
        "failed_persistence=%(failed_persistence_count)s, "
        "code=%(completion_code)s].",
        {
            **metrics,
            "completion_code": (
                "SETTLEMENT_DOWNLOAD_AND_PARSE_INCOMPLETE" if incomplete else "COMPLETE"
            ),
        },
        extra={"amazon_scope": settings.amazon_scope, **metrics},
    )
    return 1 if incomplete else 0
