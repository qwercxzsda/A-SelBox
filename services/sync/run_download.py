import argparse
import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from run_common import (
    add_database_argument,
    add_log_and_env_arguments,
    configure_logging,
    get_refresh_token,
    maybe_load_dotenv,
    positive_int,
)
from src.amazon import ReportsClientFactory, validate_endpoint
from src.database import LOCAL_SUPABASE_URL, PostgresDatabaseConnection
from src.settlements import sync_settlement_reports

DEFAULT_AMZ_ENDPOINT: str = "NA"
DEFAULT_DB_ADDRESS: str = LOCAL_SUPABASE_URL
DEFAULT_DAYS: int = 14
DEFAULT_OUTPUT_DIR: Path | None = None
DEFAULT_LOG_LEVEL: str = "INFO"
DEFAULT_LOAD_DOTENV: bool = True

logger: logging.Logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DownloadRunSettings:
    amz_endpoint: str
    db_address: str
    refresh_token: str = field(repr=False)
    days: int
    output_dir: Path | None


def build_parser() -> argparse.ArgumentParser:
    """Build the settlement download/insert parser."""
    parser = argparse.ArgumentParser(
        description="Step A: download Amazon settlement reports and insert raw rows.",
    )
    parser.add_argument(
        "--amz-endpoint",
        default=DEFAULT_AMZ_ENDPOINT,
        help="Amazon SP-API regional endpoint code.",
    )
    add_database_argument(parser, DEFAULT_DB_ADDRESS)
    parser.add_argument(
        "--refresh-token",
        default=None,
        help="SP-API refresh token. Defaults to REFRESH_TOKEN_<amz-endpoint>.",
    )
    parser.add_argument(
        "--days",
        default=DEFAULT_DAYS,
        type=positive_int,
        help="Number of recent days to search for settlement reports.",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        type=Path,
        help="Directory for downloaded report files. Defaults to a temporary directory.",
    )
    add_log_and_env_arguments(parser, DEFAULT_LOG_LEVEL, DEFAULT_LOAD_DOTENV)
    return parser


def settings_from_args(args: argparse.Namespace) -> DownloadRunSettings:
    """Convert parsed CLI arguments into typed Step A settings."""
    amz_endpoint: str = validate_endpoint(args.amz_endpoint)
    return DownloadRunSettings(
        amz_endpoint=amz_endpoint,
        db_address=args.db_address,
        refresh_token=get_refresh_token(amz_endpoint, args.refresh_token),
        days=args.days,
        output_dir=args.output_dir,
    )


def run(settings: DownloadRunSettings) -> list[str]:
    """Run Step A: download settlement reports and insert raw rows."""
    return sync_settlement_reports(
        client_factory=ReportsClientFactory(settings.amz_endpoint, settings.refresh_token),
        database=PostgresDatabaseConnection(settings.db_address),
        days=settings.days,
        output_dir=settings.output_dir,
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Parse CLI arguments and run Step A."""
    parser = build_parser()
    args = parser.parse_args(argv)
    configure_logging(args.log_level)
    maybe_load_dotenv(args.load_dotenv)

    settings: DownloadRunSettings = settings_from_args(args)
    inserted_settlement_ids: list[str] = run(settings)
    logger.info(
        "Step A finished.",
        extra={
            "amz_endpoint": settings.amz_endpoint,
            "days": settings.days,
            "inserted_settlement_ids": inserted_settlement_ids,
            "inserted_count": len(inserted_settlement_ids),
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
