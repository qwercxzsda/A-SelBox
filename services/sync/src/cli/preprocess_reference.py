"""Replay an archived reference answer using the current preprocessing rules."""

import argparse
import logging
from collections.abc import Sequence
from pathlib import Path

from ..database.connection import PostgresDatabaseConnection
from ..reference.publication import preprocess_reference
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import initialize_cli


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    add_archive_arguments(parser)
    args = initialize_cli(parser, argv)
    try:
        with PostgresDatabaseConnection(args.database_url) as database:
            preprocess_reference(database, archive_storage_from_args(args), args.manifest)
    except Exception as error:
        logging.getLogger(__name__).error(
            "Reference preprocessing failed [exception_type=%s].", type(error).__name__
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
