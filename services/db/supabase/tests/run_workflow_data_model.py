"""Run the workflow-data-model SQL checks against local Supabase."""

import argparse
from collections.abc import Sequence
from pathlib import Path

import psycopg

from services.db.supabase.tests.local_database import (
    DEFAULT_DATABASE_URL,
    assert_migrated_local_schema,
    read_trusted_sql,
    require_local_supabase_url,
)


def build_parser() -> argparse.ArgumentParser:
    """Build the loopback-only verification command parser."""
    parser = argparse.ArgumentParser(
        description="Run rollback-only workflow data model verification.",
    )
    parser.add_argument(
        "--database-url",
        default=DEFAULT_DATABASE_URL,
        help="Expected local Supabase Postgres URL on port 54322.",
    )
    return parser


def run(database_url: str) -> None:
    """Execute every numbered SQL helper and roll all fixtures back."""
    require_local_supabase_url(database_url)
    helper_directory = Path(__file__).with_name("workflow_data_model")
    helper_paths = sorted(helper_directory.glob("[0-9][0-9]_*.sql"))
    if not helper_paths:
        raise RuntimeError("No workflow data model SQL verification files were found.")

    with psycopg.connect(database_url) as connection:
        assert_migrated_local_schema(connection)
        try:
            for helper_path in helper_paths:
                try:
                    connection.execute(read_trusted_sql(helper_path))
                except Exception as error:
                    error.add_note(f"Workflow SQL helper failed: {helper_path.name}")
                    raise
            connection.execute("set constraints all immediate")
        finally:
            connection.rollback()


def main(argv: Sequence[str] | None = None) -> int:
    """Run local checks without printing fixture values."""
    args = build_parser().parse_args(argv)
    run(args.database_url)
    print("Workflow data model SQL verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
