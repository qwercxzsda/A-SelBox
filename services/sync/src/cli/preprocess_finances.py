"""Preprocess a complete archived Finances acquisition offline."""

import argparse
import logging
from collections.abc import Sequence

from ..database.connection import PostgresDatabaseConnection
from ..finances.workflow import preprocess_finances_acquisition
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import initialize_cli

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acquisition-id", required=True)
    add_archive_arguments(parser)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    try:
        storage = archive_storage_from_args(args)
        with PostgresDatabaseConnection(args.database_url) as database:
            batch = preprocess_finances_acquisition(database, storage, args.acquisition_id)
        logger.info("Finances preprocessing complete [batch_id=%s].", batch)
        return 0
    except Exception as error:
        logger.error("Finances preprocessing failed [exception_type=%s].", type(error).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
