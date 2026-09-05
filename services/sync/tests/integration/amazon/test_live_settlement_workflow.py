"""Opt-in Amazon Settlement download/parse and local Postgres workflow test."""

import logging
import os
import unittest

from dotenv import load_dotenv

from ....src.amazon.marketplaces import get_credential_scope
from ....src.cli.common import configure_logging
from ....src.cli.download_and_parse_settlement_reports import (
    SettlementDownloadAndParseSettings,
    run,
)
from ....src.database.config import LOCAL_SUPABASE_URL
from ....src.database.local_postgres import validate_local_postgres_database_url

logger: logging.Logger = logging.getLogger(__name__)

# Environment variables:
# - RUN_REAL_AMAZON_SP_API_TESTS=1 gates real Amazon calls and local DB writes.
#   Keep this flag outside .env so normal test discovery skips before reading secrets.
# - REAL_AMAZON_SCOPE selects the exact credential/provenance scope. Defaults to NA.
# - REFRESH_TOKEN_{scope}, such as REFRESH_TOKEN_JAPAN, is required.
# - REAL_SETTLEMENT_DATABASE_URL can select another loopback postgres/postgres test DB.


def get_real_amazon_postgres_test_settings() -> SettlementDownloadAndParseSettings:
    """Load settings for the real Amazon download/parse and Postgres test."""
    if os.environ.get("RUN_REAL_AMAZON_SP_API_TESTS", "").casefold() not in {"1", "true", "yes"}:
        raise unittest.SkipTest("Set RUN_REAL_AMAZON_SP_API_TESTS=1 to run this test.")

    load_dotenv()

    credential_scope = get_credential_scope(os.environ.get("REAL_AMAZON_SCOPE", "NA"))
    refresh_token_env = credential_scope.refresh_token_environment
    if not os.environ.get(refresh_token_env):
        raise unittest.SkipTest(f"Set {refresh_token_env} to run the real Amazon SP-API test.")

    database_url = validate_local_postgres_database_url(
        os.environ.get("REAL_SETTLEMENT_DATABASE_URL", LOCAL_SUPABASE_URL)
    )

    return SettlementDownloadAndParseSettings(
        amazon_scope=credential_scope.name,
        database_url=database_url,
    )


class TestLiveAmazonLocalPostgresSettlementWorkflow(unittest.TestCase):
    def test_download_parse_and_atomic_store_with_real_amazon_and_postgres(self) -> None:
        """Download, parse, and atomically store successful reports."""
        settings = get_real_amazon_postgres_test_settings()
        logger.info(
            "Running real Amazon Settlement download-and-parse test. scope=%s",
            settings.amazon_scope,
        )

        result = run(settings)
        self.assertEqual(result.failed_count, 0)

        logger.info(
            "Real workflow results: listed=%s inserted=%s already_stored=%s failed=%s",
            result.listed_count,
            result.inserted_count,
            result.already_stored_count,
            result.failed_count,
        )


if __name__ == "__main__":
    configure_logging("DEBUG")
    unittest.main()
