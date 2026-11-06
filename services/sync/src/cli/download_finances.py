"""Download complete monthly Finances captures for offline transaction preprocessing."""

import argparse
import logging
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from ..amazon.credentials import close_quietly, load_lwa_credentials
from ..amazon.finances.client import FinancesHttpClient
from ..amazon.finances.marketplaces import fetch_financial_marketplace_ids
from ..amazon.marketplaces import get_credential_scope
from ..amazon.scopes import DEFAULT_AMAZON_SCOPE
from ..finances.acquisition import DEFAULT_MAX_FINANCES_PAGES, download_finances_acquisition
from ..finances.acquisition_models import FinancesAcquisition
from ..finances.manifests import write_finances_manifest
from ..finances.marketplaces import coverage_marketplaces
from ..finances.query_windows import monthly_query_windows, transaction_query_parameters
from .archive_common import archive_storage_from_args
from .common import (
    add_log_and_env_arguments,
    add_seller_argument,
    canonical_date,
    initialize_cli,
    positive_int,
)

_LOG = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Archive Finances transactions and Summary controls, split by calendar month."
    )
    parser.add_argument("--scope", default=DEFAULT_AMAZON_SCOPE)
    add_seller_argument(parser)
    parser.add_argument("--start-date", type=canonical_date, required=True)
    parser.add_argument("--end-date", type=canonical_date, required=True)
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
        help="New local manifest file for the downloaded monthly captures.",
    )
    parser.add_argument(
        "--supabase-url", help="Supabase URL; defaults to SUPABASE_URL or the local stack."
    )
    add_log_and_env_arguments(parser)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    client: FinancesHttpClient | None = None
    try:
        if args.manifest_output.exists():
            raise FileExistsError("Refusing to overwrite an existing Finances download manifest.")
        scope = get_credential_scope(args.scope)
        windows = tuple(monthly_query_windows(args.start_date, args.end_date))
        credentials = load_lwa_credentials(scope.refresh_token_environment)
        ids = (
            tuple(args.marketplace_ids)
            if args.marketplace_ids
            else fetch_financial_marketplace_ids(scope, credentials)
        )
        marketplaces = coverage_marketplaces(scope.name, ids)
        observed_at = datetime.now(UTC)
        for start, end in windows:
            transaction_query_parameters(marketplaces, start, end, observed_at=observed_at)
        storage = archive_storage_from_args(args)
        client = FinancesHttpClient(scope.name, credentials)
        acquisitions: list[FinancesAcquisition] = []
        for start, end in windows:
            acquisition = download_finances_acquisition(
                client,
                storage,
                seller_namespace=args.seller_namespace,
                amazon_scope=scope.name,
                marketplaces=marketplaces,
                query_start_date=start,
                query_end_date=end,
                max_pages=args.max_pages,
            )
            acquisitions.append(acquisition)
            write_finances_manifest(args.manifest_output, acquisitions)
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
