"""Shared private archive configuration for acquisition and offline commands."""

import argparse
import os

from ..archives.storage import SupabaseArchiveStorage
from .common import add_database_argument, add_log_and_env_arguments


def add_archive_arguments(parser: argparse.ArgumentParser) -> None:
    add_database_argument(parser)
    parser.add_argument(
        "--supabase-url", help="Supabase URL; defaults to SUPABASE_URL or the local stack."
    )
    add_log_and_env_arguments(parser)


def archive_storage_from_args(args: argparse.Namespace) -> SupabaseArchiveStorage:
    """Read the service key from process environment without exposing it in argv."""
    return SupabaseArchiveStorage(
        args.supabase_url or os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321"),
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
    )
