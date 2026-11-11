"""Preprocess a complete archived Finances acquisition offline."""

import argparse
import logging
from collections.abc import Sequence
from pathlib import Path

from ..database.connection import PostgresDatabaseConnection
from ..finances.manifests import read_finances_manifest
from ..finances.workflow import preprocess_finances_acquisition
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import initialize_cli

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Local manifest written by download_finances.")
    add_archive_arguments(parser)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    try:
        acquisition = read_finances_manifest(args.manifest)
        storage = archive_storage_from_args(args)
        with PostgresDatabaseConnection(args.database_url) as database:
            batch_id = preprocess_finances_acquisition(database, storage, acquisition)
        logger.info("Finances preprocessing complete [batch_id=%s].", batch_id)
        return 0
    except Exception as error:
        logger.error("Finances preprocessing failed [exception_type=%s].", type(error).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
