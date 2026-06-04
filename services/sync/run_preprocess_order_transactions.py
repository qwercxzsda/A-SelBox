import argparse
import logging
from collections.abc import Sequence
from dataclasses import dataclass

from run_common import (
    add_database_argument,
    add_log_and_env_arguments,
    add_preprocess_arguments,
    add_settlement_selector_arguments,
    configure_logging,
    get_selected_settlement_ids,
    maybe_load_dotenv,
)
from src.database import (
    LOCAL_SUPABASE_URL,
    PostgresDatabaseConnection,
    PreprocessResult,
    preprocess_order_transactions,
)

DEFAULT_DB_ADDRESS: str = LOCAL_SUPABASE_URL
DEFAULT_PREPROCESS_VERSION: str = "order-v1"
DEFAULT_PREPROCESS_DESCRIPTION: str = ""
DEFAULT_LOG_LEVEL: str = "INFO"
DEFAULT_LOAD_DOTENV: bool = True

logger: logging.Logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OrderPreprocessRunSettings:
    db_address: str
    settlement_ids: list[str]
    all_settlements: bool
    preprocess_version: str
    preprocess_description: str


def build_parser() -> argparse.ArgumentParser:
    """Build the order transaction preprocessing parser."""
    parser = argparse.ArgumentParser(
        description="Step B: preprocess settlement rows into private.order_transactions.",
    )
    add_database_argument(parser, DEFAULT_DB_ADDRESS)
    add_settlement_selector_arguments(parser)
    add_preprocess_arguments(
        parser,
        DEFAULT_PREPROCESS_VERSION,
        DEFAULT_PREPROCESS_DESCRIPTION,
    )
    add_log_and_env_arguments(parser, DEFAULT_LOG_LEVEL, DEFAULT_LOAD_DOTENV)
    return parser


def settings_from_args(args: argparse.Namespace) -> OrderPreprocessRunSettings:
    """Convert parsed CLI arguments into typed Step B settings."""
    return OrderPreprocessRunSettings(
        db_address=args.db_address,
        settlement_ids=list(args.settlement_ids or []),
        all_settlements=args.all_settlements,
        preprocess_version=args.preprocess_version,
        preprocess_description=args.preprocess_description,
    )


def run(settings: OrderPreprocessRunSettings) -> list[PreprocessResult]:
    """Run Step B for selected settlements."""
    results: list[PreprocessResult] = []
    with PostgresDatabaseConnection(settings.db_address) as database:
        settlement_ids: list[str] = get_selected_settlement_ids(
            database,
            settings.settlement_ids,
            settings.all_settlements,
        )
        for settlement_id in settlement_ids:
            result = preprocess_order_transactions(
                database,
                settlement_id,
                preprocess_version=settings.preprocess_version,
                preprocess_description=settings.preprocess_description,
            )
            results.append(result)
            logger.info(
                "Preprocessed order transactions.",
                extra={
                    "settlement_id": result.settlement_id,
                    "preprocess_run_id": result.preprocess_run_id,
                    "inserted_count": result.inserted_count,
                    "mapping_count": result.mapping_count,
                    "marked_not_current_count": result.marked_not_current_count,
                },
            )

    return results


def main(argv: Sequence[str] | None = None) -> int:
    """Parse CLI arguments and run Step B."""
    parser = build_parser()
    args = parser.parse_args(argv)
    configure_logging(args.log_level)
    maybe_load_dotenv(args.load_dotenv)

    settings: OrderPreprocessRunSettings = settings_from_args(args)
    results: list[PreprocessResult] = run(settings)
    logger.info(
        "Step B finished.",
        extra={
            "preprocess_version": settings.preprocess_version,
            "processed_count": len(results),
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
