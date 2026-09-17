"""Preprocess complete day versions from a saved Data Kiosk acquisition."""

import argparse
import logging
from collections.abc import Sequence

from ..data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from ..database.connection import PostgresDatabaseConnection
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import initialize_cli

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Parse and preprocess a saved Data Kiosk acquisition offline from Amazon."
    )
    parser.add_argument("--acquisition-id", required=True)
    add_archive_arguments(parser)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    try:
        storage = archive_storage_from_args(args)
        with PostgresDatabaseConnection(args.database_url) as database:
            batch_id = preprocess_data_kiosk_acquisition(database, storage, args.acquisition_id)
        logger.info("Data Kiosk preprocessing complete [batch_id=%s].", batch_id)
        return 0
    except Exception as error:
        logger.error("Data Kiosk preprocessing failed [exception_type=%s].", type(error).__name__)
        return 1
