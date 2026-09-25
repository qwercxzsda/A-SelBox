"""Measure only installed transaction RPCs on fresh local disposable fixtures."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from .common import REST_CONTAINER, docker, local_password
from .fixtures import FIXTURES, clone_session
from .measurement import Record, measure


def parse_fixtures(value: str) -> tuple[str, ...]:
    selected = tuple(value.split(","))
    if (
        not selected
        or len(set(selected)) != len(selected)
        or any(name not in FIXTURES for name in selected)
    ):
        raise argparse.ArgumentTypeError("Choose density, history, or density,history")
    return selected


def positive_repetitions(value: str) -> int:
    result = int(value)
    if result < 1:
        raise argparse.ArgumentTypeError("Use at least one measured repetition")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir", type=Path, required=True, help="Fresh directory for sanitized results"
    )
    parser.add_argument("--repeat", type=positive_repetitions, default=5)
    parser.add_argument(
        "--fixtures",
        type=parse_fixtures,
        default=("density", "history"),
        help="density, history, or density,history (default)",
    )
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    password = local_password()
    image = docker("inspect", REST_CONTAINER, "--format", "{{.Config.Image}}").decode().strip()
    if not image:
        raise RuntimeError("The installed local REST image is unavailable")
    result: Record = {
        "started_at_utc": datetime.now(UTC).isoformat(),
        "postgrest_image": image,
        "scope": (
            "Installed RPCs via local HTTP JSON; count starts after rows; "
            "warm DB/OS caches and empty frontend count cache."
        ),
        "fixtures": [],
        "cleanup": {},
    }
    try:
        with TemporaryDirectory(prefix="aselbox-current-rpc-") as directory:
            temporary = Path(directory)
            with clone_session(args.fixtures, password, temporary, result["cleanup"]) as clones:
                for fixture in args.fixtures:
                    database, setup = clones.build(fixture)
                    print(json.dumps({"fixture_ready": database}), flush=True)
                    measured = measure(database, image, password, temporary, args.repeat)
                    measured["fixture_setup"] = setup
                    result["fixtures"].append(measured)
                    _save(output, result)
        result["cleanup"]["private_temporary_directory_removed"] = not temporary.exists()
    finally:
        result["finished_at_utc"] = datetime.now(UTC).isoformat()
        _save(output, result)


def _save(output: Path, result: Record) -> None:
    (output / "results.json").write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
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
