"""Compare installed totals/options RPCs against REST aggregation on disposable data."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from .aggregation_measurement import Record, measure
from .benchmark import parse_fixtures, positive_repetitions
from .common import REST_CONTAINER, docker, local_password
from .fixtures import clone_session


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
        "postgrest_image": image,
        "scope": "Alternating warm local HTTP; generated REST with exact count vs installed RPCs.",
        "fixtures": [],
        "cleanup": {},
    }
    try:
        with TemporaryDirectory(prefix="aselbox-summary-rpc-") as directory:
            temporary = Path(directory)
            with clone_session(args.fixtures, password, temporary, result["cleanup"]) as clones:
                for fixture in args.fixtures:
                    database, setup = clones.build(fixture)
                    measured = measure(database, image, password, temporary, args.repeat)
                    measured["fixture_setup"] = setup
                    result["fixtures"].append(measured)
                    (output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
        result["cleanup"]["private_temporary_directory_removed"] = not temporary.exists()
    finally:
        result["finished_at_utc"] = datetime.now(UTC).isoformat()
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
