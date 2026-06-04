import logging
import os
import unittest
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from pprint import pformat
from tempfile import TemporaryDirectory

from dotenv import load_dotenv
from psycopg.rows import dict_row
from src.amazon import ReportsClientFactory
from src.database import (
    LOCAL_SUPABASE_URL,
    PostgresDatabaseConnection,
)
from src.settlements import sync_settlement_reports

logger: logging.Logger = logging.getLogger(__name__)

# Environment variables:
# - RUN_REAL_AMAZON_SP_API_TESTS=1 gates real Amazon calls and local DB writes.
#   Keep this flag outside .env so normal test discovery skips before reading secrets.
# - REAL_AMAZON_ENDPOINT selects the SP-API endpoint. Defaults to NA.
# - REFRESH_TOKEN_{endpoint}, such as REFRESH_TOKEN_NA, is endpoint-specific and required.
# - REAL_SYNC_DATABASE_URL can redirect the test to another local/dev database.
# - REAL_AMAZON_SETTLEMENT_DAYS controls the report lookback window. Defaults to 14.

SETTLEMENTS_LOG_SQL: str = """
    select *
    from private.settlements
    order by created_at, id
"""

SETTLEMENTS_COUNT_SQL: str = """
    select count(*) as row_count
    from private.settlements
"""

SETTLEMENT_TRANSACTIONS_SAMPLE_LOG_SQL: str = """
    select *
    from private.settlement_transactions
    order by created_at desc, settlement_id, amz_report_line_no
    limit 3
"""

SETTLEMENT_TRANSACTIONS_COUNT_SQL: str = """
    select count(*) as row_count
    from private.settlement_transactions
"""


@dataclass(frozen=True)
class RealAmazonPostgresTestSettings:
    """Settings required for the opt-in real Amazon SP-API/Postgres test."""

    amazon_endpoint: str
    refresh_token: str
    database_url: str
    days: int


def remove_none_values(
    rows: Iterable[Mapping[str, object]],
) -> list[dict[str, object]]:
    """Return database rows without columns whose values are None."""
    return [{column: value for column, value in row.items() if value is not None} for row in rows]


def is_enabled(value: str | None) -> bool:
    """Return whether an environment flag explicitly enables the real-data test."""
    return value is not None and value.casefold() in {"1", "true", "yes"}


def get_real_amazon_postgres_test_settings() -> RealAmazonPostgresTestSettings:
    """Load settings for the real Amazon SP-API/Postgres integration test."""
    if not is_enabled(os.environ.get("RUN_REAL_AMAZON_SP_API_TESTS")):
        raise unittest.SkipTest("Set RUN_REAL_AMAZON_SP_API_TESTS=1 to run this test.")

    load_dotenv()

    amazon_endpoint: str = os.environ.get("REAL_AMAZON_ENDPOINT", "NA")
    refresh_token_env: str = f"REFRESH_TOKEN_{amazon_endpoint}"
    refresh_token: str | None = os.environ.get(refresh_token_env)
    if not refresh_token:
        raise unittest.SkipTest(f"Set {refresh_token_env} to run the real Amazon SP-API test.")

    database_url: str = os.environ.get("REAL_SYNC_DATABASE_URL", LOCAL_SUPABASE_URL)
    days: int = int(os.environ.get("REAL_AMAZON_SETTLEMENT_DAYS", "14"))
    if days < 1:
        raise ValueError("REAL_AMAZON_SETTLEMENT_DAYS must be greater than or equal to 1.")

    return RealAmazonPostgresTestSettings(
        amazon_endpoint=amazon_endpoint,
        refresh_token=refresh_token,
        database_url=database_url,
        days=days,
    )


class TestRealAmazonPostgresSync(unittest.TestCase):
    def test_sync_real_amazon_settlement_reports_to_local_postgres(self) -> None:
        """Run the production sync path with real SP-API data and local Postgres."""
        settings: RealAmazonPostgresTestSettings = get_real_amazon_postgres_test_settings()
        logger.info(
            "Running real Amazon SP-API settlement sync test. endpoint=%s days=%s",
            settings.amazon_endpoint,
            settings.days,
        )

        with TemporaryDirectory() as tmp_dir:
            inserted_settlement_ids: list[str] = sync_settlement_reports(
                client_factory=ReportsClientFactory(
                    settings.amazon_endpoint,
                    settings.refresh_token,
                ),
                database=PostgresDatabaseConnection(settings.database_url),
                days=settings.days,
                output_dir=Path(tmp_dir),
            )

        logger.info("Inserted settlement IDs from real sync: %s", inserted_settlement_ids)

        with (
            PostgresDatabaseConnection(settings.database_url) as database,
            database.connection() as conn,
            conn.cursor(row_factory=dict_row) as cursor,
        ):
            cursor.execute(SETTLEMENTS_LOG_SQL)
            settlement_rows = cursor.fetchall()

            cursor.execute(SETTLEMENTS_COUNT_SQL)
            settlement_count = cursor.fetchone()["row_count"]

            cursor.execute(SETTLEMENT_TRANSACTIONS_SAMPLE_LOG_SQL)
            transaction_rows = cursor.fetchall()

            cursor.execute(SETTLEMENT_TRANSACTIONS_COUNT_SQL)
            transaction_count = cursor.fetchone()["row_count"]

            logger.info("private.settlements row count: %s", settlement_count)
            logger.info(
                "Whole private.settlements table after real sync:\n%s",
                pformat(remove_none_values(settlement_rows)),
            )
            logger.info("private.settlement_transactions row count: %s", transaction_count)
            logger.info(
                "Top 3 private.settlement_transactions rows after real sync:\n%s",
                pformat(remove_none_values(transaction_rows)),
            )

        self.assertIsInstance(inserted_settlement_ids, list)


if __name__ == "__main__":
    logging.basicConfig(
        format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s -- %(message)s",
        datefmt="%m/%d/%Y %H:%M:%S",
        level=logging.DEBUG,
    )

    unittest.main()
