"""Measure visible search and capped amount ordering on disposable million-row fixtures."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from .benchmark import parse_fixtures, positive_repetitions
from .common import REST_CONTAINER, docker, local_password
from .fixtures import clone_session
from .search_measurement import Record, measure


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--repeat", type=positive_repetitions, default=5)
    parser.add_argument("--fixtures", type=parse_fixtures, default=("density", "history"))
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    password = local_password()
    image = docker("inspect", REST_CONTAINER, "--format", "{{.Config.Image}}").decode().strip()
    result: Record = {
        "started_at_utc": datetime.now(UTC).isoformat(),
        "status": "running",
        "postgrest_image": image,
        "scope": (
            "Final visible-field search and capped amount ordering, no amount indexes. "
            "Warm local HTTP page then count; independent authorized-view SQL correctness oracle."
        ),
        "fixtures": [],
        "cleanup": {},
    }
    temporary: Path | None = None
    try:
        with TemporaryDirectory(prefix="aselbox-search-rpc-") as directory:
            temporary = Path(directory)
            with clone_session(args.fixtures, password, temporary, result["cleanup"]) as clones:
                for fixture in args.fixtures:
                    database, setup = clones.build(fixture)
                    print(json.dumps({"fixture_ready": database}), flush=True)
                    measured = measure(database, image, password, temporary, args.repeat)
                    measured["fixture_setup"] = setup
                    result["fixtures"].append(measured)
                    (output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
        result["status"] = "completed"
    except BaseException:
        result["status"] = "interrupted_or_failed"
        raise
    finally:
        if temporary is not None:
            result["cleanup"]["private_temporary_directory_removed"] = not temporary.exists()
        result["finished_at_utc"] = datetime.now(UTC).isoformat()
        (output / "results.json").write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            json.dumps(
                {
                    "failed": type(error).__name__,
                    "sqlstate": getattr(error, "sqlstate", None),
                    "reason": str(error) if isinstance(error, RuntimeError) else None,
                }
            ),
            flush=True,
        )
        raise SystemExit(1) from None
