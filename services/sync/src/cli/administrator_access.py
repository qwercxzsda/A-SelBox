"""Grant/revoke administrator access with explicitly selected DB credentials."""

import argparse
import os
from collections.abc import Sequence

from ..database.account_access import set_administrator_access
from ..database.connection import PostgresDatabaseConnection
from .common import add_log_and_env_arguments, initialize_cli


def main(argv: Sequence[str] | None = None) -> None:
    """Keep DB secrets in environment variables, never in command-line arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("grant", "revoke"))
    parser.add_argument("user_id", help="Existing Supabase Auth user UUID.")
    parser.add_argument(
        "--database-url-env",
        default="DATABASE_URL",
        help="Environment variable for the DB manager's PostgreSQL URL (default: DATABASE_URL).",
    )
    add_log_and_env_arguments(parser)
    args = initialize_cli(parser, argv)
    database_url = os.environ.get(args.database_url_env)
    if not database_url:
        parser.error("The selected database URL environment variable is empty.")
    with PostgresDatabaseConnection(database_url) as database:
        role = set_administrator_access(
            database, user_id=args.user_id, enabled=args.action == "grant"
        )
    print(f"Account access: {role.capitalize()}")


if __name__ == "__main__":
    main()
