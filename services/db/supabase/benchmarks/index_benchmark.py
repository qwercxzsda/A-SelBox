"""Compare optional index families on one owned, disposable history clone."""

from __future__ import annotations

import argparse
import json
import time
import traceback
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, cast

from .common import catalog_fingerprint, connect, identities
from .fixtures import clone_session
from .index_cases import discover, final_guardrails
from .index_measurement import measure
from .index_variants import PILOTS, apply, assert_rules_unchanged, capture, inventory, restore
from .runner import cli, runtime, save

Record = dict[str, Any]


def _wait(path: Path, seconds: int = 900) -> Record:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if path.exists():
            value = json.loads(path.read_text())
            if not isinstance(value, dict):
                raise ValueError("Coordination file must contain a JSON object")
            return cast(Record, value)
        time.sleep(1)
    raise TimeoutError("Index experiment handoff timed out; removing its clone")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    password, image = runtime()
    result: Record = {
        "started_at_utc": datetime.now(UTC).isoformat(),
        "status": "running",
        "method": (
            "One history clone; unchanged installed RPCs and RLS; normal planner. "
            "Each optional index set freshly built, one warmup, one pilot repetition, "
            "three finalist repetitions. Exact rows and decimal strings match baseline. "
            "Plans are separate, untimed installed-query diagnostics. No assumed workload weights."
        ),
        "pilots": [],
        "finalists": [],
        "cleanup": {},
    }
    temporary: Path | None = None
    try:
        with TemporaryDirectory(prefix="aselbox-index-design-") as directory:
            temporary = Path(directory)
            with clone_session(("history",), password, temporary, result["cleanup"]) as clones:
                database, setup = clones.build("history")
                result["fixture_setup"] = setup
                with connect(database, password) as connection:
                    definitions, protected = capture(connection)
                    subjects = identities(connection)
                    cases, scopes = discover(connection, subjects)
                    result["scope_cardinalities"] = scopes
                    result["cases"] = [{"role": case.role, "name": case.name} for case in cases]
                    result["baseline_optional_definitions"] = definitions
                    result["catalog_before"] = protected
                references: dict[tuple[str, str], object] = {}
                try:
                    for variant in PILOTS:
                        with connect(database, password) as connection:
                            name = apply(connection, variant, definitions)
                            assert_rules_unchanged(connection, protected)
                        print(json.dumps({"pilot_started": name, "cases": len(cases)}), flush=True)
                        measured = measure(
                            database, image, password, temporary, subjects, cases, references, 1
                        )
                        measured["name"] = name
                        result["pilots"].append(measured)
                        save(output / "results.json", result)
                        print(
                            json.dumps(
                                {
                                    "pilot_finished": name,
                                    "optional_bytes": measured["optional_index_bytes"],
                                }
                            ),
                            flush=True,
                        )
                    save(output / "pilot-ready.json", {"database": database, "cases": len(cases)})
                    choice = _wait(output / "selection.json")
                    selected = choice["selected"]
                    raw_variants = choice.get("finalists", ["baseline", selected])
                    if not isinstance(raw_variants, list):
                        raise ValueError("Finalists must be a list")
                    variants = cast(list[str | Record], raw_variants)
                    if not variants or variants[0] != "baseline" or len(variants) > 4:
                        raise ValueError("Choose up to four finalist sets, starting with baseline")
                    with connect(database, password) as connection:
                        guards = final_guardrails(connection, subjects)
                    cases.extend(guards)
                    result["final_guardrails"] = [
                        {"role": case.role, "name": case.name} for case in guards
                    ]
                    for variant in variants:
                        with connect(database, password) as connection:
                            name = apply(connection, variant, definitions)
                            assert_rules_unchanged(connection, protected)
                        print(json.dumps({"finalist_started": name}), flush=True)
                        measured = measure(
                            database, image, password, temporary, subjects, cases, references, 3
                        )
                        measured["name"] = name
                        result["finalists"].append(measured)
                        save(output / "results.json", result)
                        print(json.dumps({"finalist_finished": name}), flush=True)
                    with connect(database, password) as connection:
                        selected_name = apply(connection, selected, definitions)
                        assert_rules_unchanged(connection, protected)
                        selected_indexes = inventory(connection)
                    result["selected"] = selected
                    save(output / "results.json", result)
                    save(
                        output / "write-probe-ready.json",
                        {
                            "database": database,
                            "selected": selected_name,
                            "indexes": selected_indexes,
                        },
                    )
                    print(json.dumps({"write_probe_ready": database}), flush=True)
                    if _wait(output / "release.json", seconds=900).get("release") is not True:
                        raise ValueError(
                            "Expected a release confirmation after the isolated write probe"
                        )
                finally:
                    with connect(database, password) as connection:
                        restore(connection, definitions)
                        result["catalog_after"] = catalog_fingerprint(connection)
                        if result["catalog_after"] != protected:
                            raise RuntimeError(
                                "Optional-index cleanup did not restore the clone catalog"
                            )
        result["status"] = "completed"
    except BaseException as error:
        result["status"] = "interrupted_or_failed"
        result["failure"] = {
            "type": type(error).__name__,
            "sqlstate": getattr(error, "sqlstate", None),
            "trace": [
                {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
                for frame in traceback.extract_tb(error.__traceback__)
            ],
        }
        raise
    finally:
        if temporary is not None:
            result["cleanup"]["private_temporary_directory_removed"] = not temporary.exists()
        result["finished_at_utc"] = datetime.now(UTC).isoformat()
        save(output / "results.json", result)


if __name__ == "__main__":
    cli(main)
