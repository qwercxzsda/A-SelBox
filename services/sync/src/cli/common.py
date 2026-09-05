"""Argument parsing and process initialization shared by the workflow commands."""

import argparse
import logging
import math
from collections.abc import Sequence
from datetime import date

from ..database.config import LOCAL_SUPABASE_URL
from ..database.seller_namespaces import DEFAULT_SELLER_NAMESPACE

LOG_LEVELS: tuple[str, ...] = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


def canonical_date(value: str) -> date:
    """Parse exactly one YYYY-MM-DD calendar date for argparse."""
    try:
        parsed_value = date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected a date in YYYY-MM-DD format.") from exc
    if parsed_value.isoformat() != value:
        raise argparse.ArgumentTypeError("Expected a date in YYYY-MM-DD format.")
    return parsed_value


def positive_int(value: str) -> int:
    """Parse a positive integer CLI argument."""
    try:
        parsed_value: int = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Expected a positive integer, got {value!r}.") from exc

    if parsed_value < 1:
        raise argparse.ArgumentTypeError("Expected a positive integer greater than or equal to 1.")
    return parsed_value


def non_negative_float(value: str) -> float:
    """Parse a finite non-negative floating-point CLI value."""
    try:
        parsed_value = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected a non-negative number.") from exc
    if parsed_value < 0 or not math.isfinite(parsed_value):
        raise argparse.ArgumentTypeError("Expected a finite non-negative number.")
    return parsed_value


def configure_logging(log_level: str) -> None:
    """Configure process logging for a CLI run."""
    logging.basicConfig(
        format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s -- %(message)s",
        datefmt="%m/%d/%Y %H:%M:%S",
        level=getattr(logging, log_level),
    )


def add_storage_arguments(parser: argparse.ArgumentParser) -> None:
    """Add the shared database connection and seller storage boundary."""
    parser.add_argument(
        "--database-url",
        default=LOCAL_SUPABASE_URL,
        help="Postgres database connection URL.",
    )
    parser.add_argument(
        "--seller-namespace",
        default=DEFAULT_SELLER_NAMESPACE,
        help="Stable seller namespace used by workflow storage.",
    )


def add_log_and_env_arguments(parser: argparse.ArgumentParser) -> None:
    """Add common logging and dotenv arguments."""
    parser.add_argument(
        "--log-level",
        choices=LOG_LEVELS,
        default="INFO",
        help="Python logging level.",
    )
    parser.add_argument(
        "--no-load-dotenv",
        action="store_false",
        default=True,
        dest="load_dotenv",
        help="Skip loading environment variables from a local .env file.",
    )


def initialize_cli(
    parser: argparse.ArgumentParser,
    argv: Sequence[str] | None,
) -> argparse.Namespace:
    """Parse arguments and initialize the shared logging/environment boundary."""
    args: argparse.Namespace = parser.parse_args(argv)
    configure_logging(args.log_level)
    maybe_load_dotenv(args.load_dotenv)
    return args


def maybe_load_dotenv(load_dotenv_enabled: bool) -> None:
    """Load local environment variables when the command permits it."""
    if load_dotenv_enabled:
        from dotenv import load_dotenv

        load_dotenv()
