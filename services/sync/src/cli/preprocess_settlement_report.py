"""Preprocess one saved Settlement acquisition with no Amazon API access."""

import argparse
import json
import logging
from collections.abc import Sequence
from pathlib import Path
from typing import cast

from ..database.connection import PostgresDatabaseConnection
from ..settlement_preprocess.workflow import preprocess_settlement_report
from .archive_common import add_archive_arguments, archive_storage_from_args
from .common import initialize_cli

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Parse and preprocess a saved Settlement acquisition offline from Amazon."
    )
    parser.add_argument("--acquisition-id", required=True)
    parser.add_argument(
        "--retrocharge-coverage",
        type=Path,
        help="Reviewed JSON array of complete retrocharge source-line groups.",
    )
    add_archive_arguments(parser)
    return parser


def read_retrocharge_coverage(path: Path | None) -> tuple[tuple[int, ...], ...]:
    if path is None:
        return ()
    value: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError("Retrocharge coverage must be a JSON array of source-line groups.")
    groups: list[tuple[int, ...]] = []
    for item in cast(list[object], value):
        if not isinstance(item, list) or not item:
            raise ValueError("Retrocharge groups must be nonempty source-line arrays.")
        lines = cast(list[object], item)
        if any(type(line) is not int or line < 1 for line in lines):
            raise ValueError("Retrocharge source line numbers must be positive integers.")
        groups.append(tuple(cast(list[int], lines)))
    return tuple(groups)


def main(argv: Sequence[str] | None = None) -> int:
    args = initialize_cli(build_parser(), argv)
    try:
        coverage = read_retrocharge_coverage(args.retrocharge_coverage)
        storage = archive_storage_from_args(args)
        with PostgresDatabaseConnection(args.database_url) as database:
            version_id = preprocess_settlement_report(
                database, storage, args.acquisition_id, retrocharge_coverage=coverage
            )
        logger.info("Settlement preprocessing complete [version_id=%s].", version_id)
        return 0
    except Exception as error:
        logger.error("Settlement preprocessing failed [exception_type=%s].", type(error).__name__)
        return 1
