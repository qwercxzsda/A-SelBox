"""Download rolling UTC Finances observations and independent whole-day controls."""

import argparse
import logging
from collections.abc import Sequence
from datetime import UTC, datetime, time
from pathlib import Path

from ..amazon.credentials import close_quietly, load_lwa_credentials
from ..amazon.datetimes import as_utc
from ..amazon.finances.client import FinancesHttpClient
from ..amazon.finances.marketplaces import fetch_financial_marketplace_ids
from ..amazon.marketplaces import get_credential_scope
from ..amazon.scopes import DEFAULT_AMAZON_SCOPE
from ..finances.acquisition import DEFAULT_MAX_FINANCES_PAGES, download_finances_acquisition
from ..finances.manifests import write_finances_manifest
from ..finances.marketplaces import coverage_marketplaces
from ..finances.query_windows import transaction_query_parameters
from ..reference.periods import shift_months
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import add_seller_argument, initialize_cli, positive_int

_LOG = logging.getLogger(__name__)


def timestamp_argument(value: str) -> datetime:
    try:
        return as_utc(datetime.fromisoformat(value))
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "Expected an ISO 8601 timestamp with a UTC offset."
        ) from error


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Archive rolling Finances transactions for the last three calendar months "
            "to Amazon's latest available data."
        )
    )
    parser.add_argument("--scope", default=DEFAULT_AMAZON_SCOPE)
    add_seller_argument(parser)
    parser.add_argument(
        "--posted-after",
        type=timestamp_argument,
        help="Inclusive UTC instant; defaults to the same day three calendar months ago "
        "at UTC midnight.",
    )
    parser.add_argument(
        "--posted-before",
        type=timestamp_argument,
        help="Exclusive instant for an explicitly bounded historical capture; normally omitted.",
    )
    parser.add_argument(
        "--marketplace-id",
        action="append",
        dest="marketplace_ids",
        help=(
            "Explicit coverage roster (repeatable); otherwise use active seller marketplaces. "
            "Requests remain regional."
        ),
    )
    parser.add_argument("--max-pages", type=positive_int, default=DEFAULT_MAX_FINANCES_PAGES)
    parser.add_argument(
        "--manifest-output",
        type=Path,
        required=True,
        help="New local manifest file for the downloaded capture.",
    )
    add_archive_arguments(parser)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    client: FinancesHttpClient | None = None
    try:
        if args.manifest_output.exists():
            raise FileExistsError("Refusing to overwrite an existing Finances download manifest.")
        posted_after = args.posted_after or datetime.combine(
            shift_months(datetime.now(UTC).date(), -3), time.min, UTC
        )
        transaction_query_parameters(
            posted_after, args.posted_before, observed_at=datetime.now(UTC)
        )
        scope = get_credential_scope(args.scope)
        credentials = load_lwa_credentials(scope.refresh_token_environment)
        ids = (
            tuple(args.marketplace_ids)
            if args.marketplace_ids
            else fetch_financial_marketplace_ids(scope, credentials)
        )
        marketplaces = coverage_marketplaces(scope.name, ids)
        storage = archive_storage_from_args(args)
        client = FinancesHttpClient(scope.name, credentials)
        acquisition = download_finances_acquisition(
            client,
            storage,
            seller_namespace=args.seller_namespace,
            amazon_scope=scope.name,
            marketplaces=marketplaces,
            posted_after=posted_after,
            posted_before=args.posted_before,
            max_pages=args.max_pages,
        )
        write_finances_manifest(args.manifest_output, acquisition)
        _LOG.info(
            "Finances archive complete [acquisition_id=%s, manifest=%s].",
            acquisition.id,
            args.manifest_output,
        )
        return 0
    except Exception as error:
        _LOG.error("Finances archive failed [exception_type=%s].", type(error).__name__)
        return 1
    finally:
        close_quietly(client)


if __name__ == "__main__":
    raise SystemExit(main())
