import argparse
import logging
import os

from dotenv import load_dotenv
from src.database import DatabaseConnection

ALL_SETTLEMENT_IDS_SQL: str = """
    select id::text
    from private.settlements
    order by created_at, id
"""


def positive_int(value: str) -> int:
    """Parse a positive integer CLI argument."""
    try:
        parsed_value: int = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Expected a positive integer, got {value!r}.") from exc

    if parsed_value < 1:
        raise argparse.ArgumentTypeError("Expected a positive integer greater than or equal to 1.")

    return parsed_value


def configure_logging(log_level: str) -> None:
    """Configure process logging for a CLI run."""
    logging.basicConfig(
        format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s -- %(message)s",
        datefmt="%m/%d/%Y %H:%M:%S",
        level=getattr(logging, log_level),
    )


def add_database_argument(
    parser: argparse.ArgumentParser,
    default_db_address: str,
) -> None:
    """Add the common Postgres connection argument."""
    parser.add_argument(
        "--db-address",
        default=default_db_address,
        help="Postgres database connection URL.",
    )


def add_log_and_env_arguments(
    parser: argparse.ArgumentParser,
    default_log_level: str,
    default_load_dotenv: bool,
) -> None:
    """Add common logging and dotenv arguments."""
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        default=default_log_level,
        help="Python logging level.",
    )
    parser.add_argument(
        "--no-load-dotenv",
        action="store_false",
        default=default_load_dotenv,
        dest="load_dotenv",
        help="Skip loading environment variables from a local .env file.",
    )


def add_preprocess_arguments(
    parser: argparse.ArgumentParser,
    default_preprocess_version: str,
    default_preprocess_description: str,
) -> None:
    """Add common preprocess run metadata arguments."""
    parser.add_argument(
        "--preprocess-version",
        default=default_preprocess_version,
        help="Preprocess version recorded on preprocess run rows.",
    )
    parser.add_argument(
        "--preprocess-description",
        default=default_preprocess_description,
        help="Description recorded on preprocess run rows.",
    )


def add_settlement_selector_arguments(parser: argparse.ArgumentParser) -> None:
    """Add settlement selectors for preprocessing steps."""
    parser.add_argument(
        "--settlement-id",
        action="append",
        default=None,
        dest="settlement_ids",
        help="Settlement ID to preprocess. Repeat this argument for multiple settlements.",
    )
    parser.add_argument(
        "--all-settlements",
        action="store_true",
        help="Preprocess every settlement row in private.settlements.",
    )


def maybe_load_dotenv(load_dotenv_enabled: bool) -> None:
    """Load local environment variables when the run file permits it."""
    if load_dotenv_enabled:
        load_dotenv()


def get_refresh_token(amz_endpoint: str, refresh_token: str | None) -> str:
    """Return an explicit refresh token or load the endpoint-specific env var."""
    if refresh_token:
        return refresh_token

    refresh_token_env: str = f"REFRESH_TOKEN_{amz_endpoint}"
    env_refresh_token: str | None = os.environ.get(refresh_token_env)
    if env_refresh_token:
        return env_refresh_token

    raise RuntimeError(f"Pass --refresh-token or set {refresh_token_env}.")


def get_selected_settlement_ids(
    database: DatabaseConnection,
    settlement_ids: list[str],
    all_settlements: bool,
) -> list[str]:
    """Return explicit settlement IDs or load all settlement IDs from Postgres."""
    if settlement_ids and all_settlements:
        raise ValueError("Use either --settlement-id or --all-settlements, not both.")

    if settlement_ids:
        return settlement_ids

    if not all_settlements:
        raise ValueError("Pass at least one --settlement-id or use --all-settlements.")

    with database.connection() as conn, conn.cursor() as cursor:
        cursor.execute(ALL_SETTLEMENT_IDS_SQL)
        return [str(row[0]) for row in cursor.fetchall()]
