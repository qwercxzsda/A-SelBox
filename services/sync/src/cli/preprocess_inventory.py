"""Preprocess an archived inventory acquisition without Amazon access."""

import argparse
import logging
from collections.abc import Sequence

from ..database.connection import PostgresDatabaseConnection
from ..inventory.workflow import preprocess_inventory_acquisition
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import initialize_cli

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preprocess a saved daily inventory acquisition offline."
    )
    parser.add_argument("--acquisition-id", required=True)
    add_archive_arguments(parser)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    try:
        storage = archive_storage_from_args(args)
        with PostgresDatabaseConnection(args.database_url) as database:
            capture_id = preprocess_inventory_acquisition(database, storage, args.acquisition_id)
        logger.info("Inventory preprocessing complete [capture_id=%s].", capture_id)
        return 0
    except Exception as error:
        logger.error("Inventory preprocessing failed [exception_type=%s].", type(error).__name__)
        return 1
