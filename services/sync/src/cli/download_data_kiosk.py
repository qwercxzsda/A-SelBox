"""Download complete Data Kiosk query responses into immutable archives."""

import argparse
import logging
from collections.abc import Sequence
from datetime import UTC, datetime

from ..amazon.client import create_data_kiosk_client
from ..amazon.credentials import close_quietly, load_lwa_credentials
from ..amazon.data_kiosk.lifecycle import DEFAULT_MAX_POLL_ATTEMPTS, DEFAULT_POLL_INTERVAL_SECONDS
from ..amazon.data_kiosk.limits import DEFAULT_MAX_DATA_PAGES
from ..amazon.marketplaces import get_credential_scope
from ..amazon.scopes import DEFAULT_AMAZON_SCOPE
from ..data_kiosk_economics.acquisition import download_data_kiosk_acquisition
from ..data_kiosk_economics.query_windows import validate_query_window
from ..database.connection import PostgresDatabaseConnection
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import (
    add_seller_argument,
    canonical_date,
    initialize_cli,
    non_negative_float,
    positive_int,
)

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download and archive complete Data Kiosk Economics responses without parsing."
    )
    parser.add_argument("--scope", default=DEFAULT_AMAZON_SCOPE)
    add_seller_argument(parser)
    parser.add_argument("--marketplace-id", required=True)
    parser.add_argument("--start-date", type=canonical_date, required=True)
    parser.add_argument("--end-date", type=canonical_date, required=True)
    parser.add_argument("--max-pages", type=positive_int, default=DEFAULT_MAX_DATA_PAGES)
    parser.add_argument("--max-poll-attempts", type=positive_int, default=DEFAULT_MAX_POLL_ATTEMPTS)
    parser.add_argument(
        "--poll-interval-seconds", type=non_negative_float, default=DEFAULT_POLL_INTERVAL_SECONDS
    )
    add_archive_arguments(parser)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    client = None
    try:
        storage = archive_storage_from_args(args)
        scope = get_credential_scope(args.scope)
        if args.marketplace_id not in scope.marketplace_ids:
            raise ValueError("Requested marketplace does not belong to the Amazon scope.")
        # Validate coverage before any Amazon request; only complete local days are queried.
        validate_query_window(
            args.marketplace_id, args.start_date, args.end_date, observed_at=datetime.now(UTC)
        )
        credentials = load_lwa_credentials(scope.refresh_token_environment)
        client = create_data_kiosk_client(scope.client_marketplace, credentials)
        with PostgresDatabaseConnection(args.database_url) as database:
            acquisition_id = download_data_kiosk_acquisition(
                client,
                database,
                storage,
                seller_namespace=args.seller_namespace,
                amazon_scope=args.scope,
                marketplace_id=args.marketplace_id,
                query_start_date=args.start_date,
                query_end_date=args.end_date,
                max_pages=args.max_pages,
                max_poll_attempts=args.max_poll_attempts,
                poll_interval_seconds=args.poll_interval_seconds,
            )
        logger.info("Data Kiosk archive complete [acquisition_id=%s].", acquisition_id)
        return 0
    except Exception as error:
        logger.error("Data Kiosk archive failed [exception_type=%s].", type(error).__name__)
        return 1
    finally:
        close_quietly(client)
