"""Sync Finances and all product attribution sources for one or more seller accounts."""

import argparse
import logging
from collections.abc import Sequence
from pathlib import Path
from uuid import uuid7

from ..amazon.scopes import AMAZON_SCOPES
from ..database.connection import PostgresDatabaseConnection
from ..finances.manifests import read_finances_manifest
from ..finances.workflow import preprocess_finances_acquisition
from ..reference.acquisition import NAMED_SOURCES
from ..reference.currencies import load_currency_decimals
from ..reference.reports import REPORT_TYPES
from ..reference.run import run_sources
from . import download_finances
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import add_seller_argument, canonical_date, initialize_cli


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scope",
        action="append",
        choices=AMAZON_SCOPES,
        help="Repeat to select accounts. Defaults to all five.",
    )
    sources = ("FINANCES", *REPORT_TYPES, *NAMED_SOURCES)
    parser.add_argument(
        "--source", choices=sources, action="append", help="Run only the selected source(s)."
    )
    parser.add_argument(
        "--id",
        action="append",
        help="Refresh a specific referenced ID for a single named source and account.",
    )
    parser.add_argument("--manifest-directory", type=Path, required=True)
    parser.add_argument(
        "--report-start-month",
        type=canonical_date,
        help="First day of earliest report month; overrides source-specific defaults.",
    )
    parser.add_argument(
        "--report-end-month",
        type=canonical_date,
        help="First day of latest report month, inclusive. Monthly reports use finished "
        "months only.",
    )
    parser.add_argument("--posted-after", type=download_finances.timestamp_argument)
    parser.add_argument("--posted-before", type=download_finances.timestamp_argument)
    add_seller_argument(parser)
    add_archive_arguments(parser)
    args = initialize_cli(parser, argv)
    selected = set(args.source or sources)
    ids: set[str] = set(args.id or ())
    if ids and (
        len(selected) != 1 or not selected.issubset(NAMED_SOURCES) or len(args.scope or ()) != 1
    ):
        parser.error("--id requires a single --scope and named --source.")
    failures = 0
    try:
        storage = archive_storage_from_args(args)
        args.manifest_directory.mkdir(parents=True, exist_ok=True)
        with PostgresDatabaseConnection(args.database_url) as database:
            decimals = load_currency_decimals(database)

            def finance(scope: str) -> None:
                directory: Path = args.manifest_directory
                path = directory / f"finances-{uuid7()}.json"
                options = [
                    "--scope",
                    scope,
                    "--seller-namespace",
                    args.seller_namespace,
                    "--manifest-output",
                    str(path),
                    "--database-url",
                    args.database_url,
                    "--no-load-dotenv",
                    "--log-level",
                    args.log_level,
                ]
                if args.supabase_url:
                    options.extend(["--supabase-url", args.supabase_url])
                for option, bound in (
                    ("--posted-after", args.posted_after),
                    ("--posted-before", args.posted_before),
                ):
                    if bound:
                        options.extend([option, bound.isoformat()])
                if download_finances.main(options):
                    raise RuntimeError("Finances download failed.")
                preprocess_finances_acquisition(
                    database, storage, read_finances_manifest(path), decimals
                )

            for scope in dict.fromkeys(args.scope or AMAZON_SCOPES):
                failures += run_sources(
                    database,
                    storage,
                    args.manifest_directory,
                    args.seller_namespace,
                    scope,
                    lambda scope=scope: finance(scope),
                    args.report_start_month,
                    args.report_end_month,
                    decimals,
                    selected,
                    ids,
                )
    except Exception as error:
        logging.getLogger(__name__).error("Sync failed [exception_type=%s].", type(error).__name__)
        return 1
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
