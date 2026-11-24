"""Private archive configuration for acquisition and offline commands."""

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit

from ..archives.storage import SupabaseArchiveStorage
from .common import add_database_argument, add_log_and_env_arguments

_LOCAL_API = "http://127.0.0.1:54321"
_DATABASE_DIRECTORY = Path(__file__).resolve().parents[3] / "db"


def add_archive_arguments(parser: argparse.ArgumentParser) -> None:
    add_database_argument(parser)
    parser.add_argument(
        "--supabase-url", help="Supabase URL; defaults to SUPABASE_URL or the local stack."
    )
    add_log_and_env_arguments(parser)


def _local_service_key(url: str) -> str:
    endpoint = urlsplit(url)
    if (
        endpoint.scheme not in {"http", "https"}
        or endpoint.hostname not in {"127.0.0.1", "::1", "localhost"}
        or endpoint.username is not None
        or endpoint.password is not None
        or endpoint.path not in {"", "/"}
        or endpoint.query
        or endpoint.fragment
    ):
        raise ValueError("Set SUPABASE_SERVICE_ROLE_KEY for this archive endpoint.")
    try:
        result = subprocess.run(  # noqa: S603 - fixed local CLI invocation, no shell
            ["supabase", "status", "--output", "json", "--workdir", str(_DATABASE_DIRECTORY)],  # noqa: S607
            capture_output=True,
            check=True,
            timeout=30,
        )
        status = json.loads(result.stdout)
    except OSError, subprocess.SubprocessError, ValueError:
        raise RuntimeError("Unable to read the local Supabase status.") from None
    if not isinstance(status, dict):
        raise RuntimeError("Unable to read the local Supabase status.")
    fields = cast(dict[str, object], status)
    if fields.get("API_URL") != url.rstrip("/"):
        raise ValueError("The requested archive endpoint differs from the local project API URL.")
    key = fields.get("SERVICE_ROLE_KEY")
    if not isinstance(key, str) or not key.strip():
        raise ValueError("The local project did not return its storage service role key.")
    return key


def archive_storage_from_args(args: argparse.Namespace) -> SupabaseArchiveStorage:
    url: str = args.supabase_url or os.environ.get("SUPABASE_URL") or _LOCAL_API
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or _local_service_key(url)
    return SupabaseArchiveStorage(url, key)
