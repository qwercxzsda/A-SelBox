"""Verify the fresh schema contract in a disposable local database."""

import argparse
from collections.abc import Sequence
from pathlib import Path

import psycopg

from services.db.supabase.tests.isolated_database import isolated_database
from services.db.supabase.tests.local_database import (
    DEFAULT_DATABASE_URL,
    read_trusted_sql,
)


def build_parser() -> argparse.ArgumentParser:
    """Build the loopback-only verification command parser."""
    parser = argparse.ArgumentParser(
        description="Run isolated source-version schema verification.",
    )
    parser.add_argument(
        "--database-url",
        default=DEFAULT_DATABASE_URL,
        help="Expected local Supabase Postgres URL on port 54322.",
    )
    return parser


def run(database_url: str) -> None:
    """Verify a new baseline without changing existing development schemas."""
    contract_path = Path(__file__).with_name("schema_contract.sql")
    with isolated_database(database_url) as test_url, psycopg.connect(test_url) as connection:
        connection.execute(read_trusted_sql(contract_path))
        connection.execute("set constraints all immediate")


def main(argv: Sequence[str] | None = None) -> int:
    """Run local checks without printing fixture values."""
    args = build_parser().parse_args(argv)
    run(args.database_url)
    print("Source-version schema contract verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
