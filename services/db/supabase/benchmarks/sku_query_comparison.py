"""Compare a trusted Git baseline and current SKU queries on identical real facts."""

# Git reads only repository SQL; query arguments and seed values stay in memory.
# ruff: noqa: S603, S607
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg

from services.db.supabase.tests.isolated_database import isolated_database

from .common import REPO, Connection
from .plans import explain_rpc
from .runner import cli
from .sku_comparison_data import ComparisonData, populate_pair
from .sku_comparison_reads import WARMUP_ROUNDS, QueryCase, comparison_cases, measure_comparison

_MIGRATIONS = Path("services/db/supabase/migrations")
_PLAN_CASES = {
    "member_count_all",
    "member_page_sku",
    "member_totals_period",
    "operator_company_count",
    "operator_all_totals",
}


def _git(*arguments: str) -> bytes:
    return subprocess.run(["git", *arguments], cwd=REPO, capture_output=True, check=True).stdout


def _snapshot_baseline(ref: str, target: Path) -> str:
    revision = _git("rev-parse", "--verify", ref + "^{commit}").decode().strip()
    paths = _git("ls-tree", "-r", "--name-only", revision, "--", str(_MIGRATIONS))
    for name in paths.decode().splitlines():
        path = Path(name)
        if path.parent == _MIGRATIONS and path.suffix == ".sql":
            (target / path.name).write_bytes(_git("show", revision + ":" + name))
    if not list(target.glob("*.sql")):
        raise ValueError("The baseline revision contains no migrations")
    return revision


def _migration_digest(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(directory.glob("*.sql")):
        digest.update(path.name.encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()


def _query_settings(connection: Connection) -> dict[str, str]:
    return dict(
        connection.execute(
            "select name,setting from pg_settings where name in "
            "('server_version','shared_buffers','work_mem','jit',"
            "'max_parallel_workers_per_gather','default_statistics_target') order by name"
        ).fetchall()
    )


def _collect_plans(
    connections: dict[str, Connection], data: ComparisonData, cases: list[QueryCase]
) -> list[dict[str, Any]]:
    return [
        {
            "case": case.name,
            "variant": variant,
            **explain_rpc(connection, data.actor_id(case.actor), case.rpc, case.arguments),
        }
        for case in cases
        if case.name in _PLAN_CASES
        for variant, connection in connections.items()
    ]


def run(seed: Path, baseline_ref: str, repeat: int) -> dict[str, Any]:
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="aselbox-query-baseline-") as directory:
        baseline = Path(directory)
        revision = _snapshot_baseline(baseline_ref, baseline)
        fingerprints = {
            "before": _migration_digest(baseline),
            "after": _migration_digest(REPO / _MIGRATIONS),
        }
        with (
            isolated_database(migrations=baseline) as before_url,
            isolated_database() as after_url,
            psycopg.connect(before_url, autocommit=True) as before,
            psycopg.connect(after_url, autocommit=True) as after,
        ):
            data = populate_pair(before, after, seed)
            print(
                json.dumps({"fixture_ready": True, "source_rows": data.source_rows}),
                flush=True,
            )
            connections = {"before": before, "after": after}
            cases = comparison_cases(data)
            settings = _query_settings(before)
            if settings != _query_settings(after):
                raise ValueError("Before and after must use identical query settings")
            measurements = measure_comparison(connections, data, cases, repeat)
            plans = _collect_plans(connections, data, cases)
            fixture = data.evidence()
        with seed.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != data.seed_sha256:
                raise AssertionError("Seed fingerprint changed during comparison")
    return {
        "recorded_at_utc": datetime.now(UTC).isoformat(),
        "baseline_revision": revision,
        "migration_sha256": fingerprints,
        "settings": settings,
        "fixture": fixture,
        "method": {
            "warmup_rounds": WARMUP_ROUNDS,
            "measured_rounds": repeat,
            "ordering": "Rotate cases each round; alternate before/after execution order",
            "timing_scope": (
                "Direct SQL statement plus result decoding; exclude role/transaction setup"
            ),
            "prepared_statements": False,
            "all_results_equivalent": True,
            "mature_cutoff_date": "2026-07-28",
            "fee_scope": (
                "Synthetic 5% fees over observed marketplace coverage: per namespace/SKU before; "
                "union of marketplaces per SKU after. No unused marketplace periods added."
            ),
        },
        "measurements": measurements,
        "plans": plans,
        "disposable_databases_removed": True,
        "original_seed_unchanged": True,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "limits": "Warm local database comparison on real source facts with synthetic consistent "
        "ownership/fees. No real ownership decisions, HTTP/browser latency, cold cache, "
        "sustained concurrency, or production latency claim. Positive reduction means faster; "
        "negative means slower. Small differences may be timing noise.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument(
        "--baseline-ref", required=True, help="Commit with namespace-scoped SKU terms"
    )
    parser.add_argument("--repeat", type=int, default=21)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not 5 <= args.repeat <= 100:
        parser.error("repeat must be between 5 and 100")
    if args.output.exists():
        parser.error("Choose a new output file")
    result = run(args.seed, args.baseline_ref, args.repeat)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, indent=2, default=str)
        output.write("\n")
    print(json.dumps({"output": str(args.output), "elapsed_seconds": result["elapsed_seconds"]}))


if __name__ == "__main__":
    cli(main)
