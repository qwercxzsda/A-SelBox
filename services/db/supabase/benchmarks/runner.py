"""Shared CLI, guarded fixture lifecycle, and sanitized benchmark reporting."""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from .common import REST_CONTAINER, docker, local_password
from .fixtures import FIXTURES, clone_session

Record = dict[str, Any]
Measurement = Callable[[str, str, str, Path, int], Record]


def parse_fixtures(value: str) -> tuple[str, ...]:
    selected = tuple(value.split(","))
    if len(set(selected)) != len(selected) or any(name not in FIXTURES for name in selected):
        raise argparse.ArgumentTypeError("Choose density, history, or density,history")
    return selected


def positive_repetitions(value: str) -> int:
    result = int(value)
    if result < 1:
        raise argparse.ArgumentTypeError("Use at least one measured repetition")
    return result


def runtime() -> tuple[str, str]:
    password = local_password()
    image = docker("inspect", REST_CONTAINER, "--format", "{{.Config.Image}}").decode().strip()
    if not image:
        raise RuntimeError("The installed local REST image is unavailable")
    return password, image


def save(path: Path, result: Record) -> None:
    temporary = path.with_suffix(".pending")
    temporary.write_text(json.dumps(result, indent=2) + "\n")
    temporary.replace(path)


def run(description: str | None, scope: str, measure: Measurement) -> None:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--output-dir", type=Path, required=True, help="Fresh sanitized result directory"
    )
    parser.add_argument("--repeat", type=positive_repetitions, default=5)
    parser.add_argument("--fixtures", type=parse_fixtures, default=("density", "history"))
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    result: Record = {
        "started_at_utc": datetime.now(UTC).isoformat(),
        "status": "running",
        "scope": scope,
        "fixtures": [],
        "cleanup": {},
    }
    temporary: Path | None = None
    try:
        password, image = runtime()
        result["postgrest_image"] = image
        with TemporaryDirectory(prefix="aselbox-benchmark-") as directory:
            temporary = Path(directory)
            with clone_session(args.fixtures, password, temporary, result["cleanup"]) as clones:
                for fixture in args.fixtures:
                    database, setup = clones.build(fixture)
                    print(json.dumps({"fixture_ready": database}), flush=True)
                    measured = measure(database, image, password, temporary, args.repeat)
                    measured["fixture_setup"] = setup
                    result["fixtures"].append(measured)
                    save(output / "results.json", result)
        result["status"] = "completed"
    except BaseException:
        result["status"] = "interrupted_or_failed"
        raise
    finally:
        if temporary is not None:
            result["cleanup"]["private_temporary_directory_removed"] = not temporary.exists()
        result["finished_at_utc"] = datetime.now(UTC).isoformat()
        save(output / "results.json", result)


def cli(main: Callable[[], None]) -> None:
    """Do not print raw database, HTTP, or Docker exceptions containing fixture data."""
    try:
        main()
    except Exception as error:
        print(
            json.dumps(
                {"failed": type(error).__name__, "sqlstate": getattr(error, "sqlstate", None)}
            ),
            flush=True,
        )
        raise SystemExit(1) from None
