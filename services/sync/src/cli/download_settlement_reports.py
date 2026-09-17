"""Download whole Settlement documents into immutable private archives."""

import argparse
import logging
from collections.abc import Sequence

from ..amazon.client import create_reports_client
from ..amazon.credentials import close_quietly, load_lwa_credentials
from ..amazon.marketplaces import get_credential_scope
from ..amazon.reports.sdk_types import SettlementReportsClient
from ..amazon.scopes import DEFAULT_AMAZON_SCOPE
from ..amazon.sellers_participations import fetch_marketplace_participations
from ..database.connection import PostgresDatabaseConnection
from ..settlements.download import download_settlement_reports
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import add_seller_argument, initialize_cli

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download and archive complete Settlement reports without parsing."
    )
    parser.add_argument("--scope", default=DEFAULT_AMAZON_SCOPE)
    add_seller_argument(parser)
    add_archive_arguments(parser)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    client: SettlementReportsClient | None = None
    try:
        storage = archive_storage_from_args(args)
        scope = get_credential_scope(args.scope)
        credentials = load_lwa_credentials(scope.refresh_token_environment)
        participations = fetch_marketplace_participations(scope, credentials)
        if not participations:
            raise ValueError("The Amazon scope has no active marketplace participation.")
        client = create_reports_client(args.scope, credentials)
        with PostgresDatabaseConnection(args.database_url) as database:
            result = download_settlement_reports(
                client,
                database,
                storage,
                amazon_scope=args.scope,
                seller_namespace=args.seller_namespace,
                marketplace_ids=tuple(item.marketplace_id for item in participations),
            )
        logger.info(
            "Settlement archive complete [listed=%s archived=%s failed=%s].",
            result.listed_count,
            result.archived_count,
            result.failed_count,
        )
        return int(result.failed_count > 0)
    except Exception as error:
        logger.error("Settlement archive failed [exception_type=%s].", type(error).__name__)
        return 1
    finally:
        close_quietly(client)
