"""Exact-response checks, normal RPC timings and post-timing diagnostic plans."""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path
from typing import Any, cast

from .common import connect, digest, synthetic_token
from .index_cases import IndexCase, sql_result
from .index_plans import explain_rpc
from .index_variants import BASE_NAMES, CANDIDATE_NAMES, inventory
from .transport import request, rest_server

Record = dict[str, Any]


def _rpc_sample(base: str, token: str, case: IndexCase) -> tuple[object, Record]:
    started = time.perf_counter()
    value, size = request(base, case.endpoint, case.arguments, token)
    elapsed = (time.perf_counter() - started) * 1000
    if not isinstance(value, dict):
        raise RuntimeError("Index case returned an invalid envelope")
    payload = cast(Record, value)
    raw_rows = payload.get("rows")
    if not isinstance(raw_rows, list):
        raise RuntimeError("Index case returned an invalid row list")
    if any(not isinstance(row, dict) for row in cast(list[object], raw_rows)):
        raise RuntimeError("Index case returned an invalid row")
    rows = cast(list[Record], raw_rows)
    if case.count_endpoint is None:
        if payload.get("next_offset") is not None:
            raise RuntimeError("Summary case exceeded its complete group limit")
        return payload, {"elapsed_ms": elapsed, "groups": len(rows), "response_bytes": size}
    if payload.get("total_count") is not None or len(rows) > 25:
        raise RuntimeError("Page/count request semantics changed")
    if any(
        any(entry is not None and not isinstance(entry, str) for entry in row.values())
        for row in rows
    ):
        raise RuntimeError("Page did not preserve exact text/NULL fields")
    count_started = time.perf_counter()
    count, count_bytes = request(base, case.count_endpoint, case.count_arguments or {}, token)
    count_ms = (time.perf_counter() - count_started) * 1000
    if not isinstance(count, str) or not count.isdecimal():
        raise RuntimeError("Count did not preserve its exact decimal string")
    return {"page": payload, "count": count}, {
        "page_ms": elapsed,
        "count_ms": count_ms,
        "all_ready_ms": (time.perf_counter() - started) * 1000,
        "rows": len(rows),
        "matching_rows": int(count),
        "response_bytes": size + count_bytes,
    }


def measure(
    database: str,
    image: str,
    password: str,
    temporary: Path,
    subjects: dict[str, str],
    cases: list[IndexCase],
    references: dict[tuple[str, str], object],
    repeat: int,
) -> Record:
    records: list[Record] = []
    with rest_server(database, password, image, temporary) as (base, secret):
        tokens = {role: synthetic_token(secret, user) for role, user in subjects.items()}
        with connect(database, password) as connection:
            for iteration in range(repeat + 1):
                selected = list(reversed(cases)) if iteration % 2 else cases
                shift = iteration % len(selected)
                for case in selected[shift:] + selected[:shift]:
                    if case.endpoint.startswith("sql_"):
                        started = time.perf_counter()
                        value = sql_result(connection, case, subjects)
                        sample = {"elapsed_ms": (time.perf_counter() - started) * 1000}
                    else:
                        value, sample = _rpc_sample(base, tokens[case.role], case)
                    key = (case.role, case.name)
                    if key not in references:
                        references[key] = value
                    if value != references[key]:
                        raise RuntimeError(
                            "An index variant changed exact authorized results: " + case.name
                        )
                    records.append(
                        {
                            "role": case.role,
                            "case": case.name,
                            "iteration": iteration,
                            "warmup": iteration == 0,
                            "result_sha256": digest(value),
                            **{key: round(number, 3) for key, number in sample.items()},
                        }
                    )
    summary: list[Record] = []
    for case in cases:
        selected = [
            row
            for row in records
            if not row["warmup"] and (row["role"], row["case"]) == (case.role, case.name)
        ]
        summary.append(
            {
                "role": case.role,
                "case": case.name,
                "metrics": {
                    key: {
                        "median": statistics.median(row[key] for row in selected),
                        "min": min(row[key] for row in selected),
                        "max": max(row[key] for row in selected),
                    }
                    for key in ("page_ms", "count_ms", "all_ready_ms", "elapsed_ms")
                    if key in selected[0]
                },
            }
        )
    with connect(database, password) as connection:
        indexes = inventory(connection)
        plans: list[Record] = []
        for case in cases:
            if case.endpoint.startswith("sql_"):
                continue
            plans.append(
                {
                    "role": case.role,
                    "case": case.name,
                    "part": "page" if case.count_endpoint else "totals",
                    **explain_rpc(connection, subjects[case.role], case.endpoint, case.arguments),
                }
            )
            if case.count_endpoint and any(
                label in case.name
                for label in ("newest", "sparse_sku", "multiple_skus", "marketplaces")
            ):
                plans.append(
                    {
                        "role": case.role,
                        "case": case.name,
                        "part": "count",
                        **explain_rpc(
                            connection,
                            subjects[case.role],
                            case.count_endpoint,
                            case.count_arguments or {},
                        ),
                    }
                )
    optional = set(BASE_NAMES) | set(CANDIDATE_NAMES)
    return {
        "repeat": repeat,
        "warmups": 1,
        "cases_verified": len(cases),
        "indexes": indexes,
        "optional_index_bytes": sum(
            index["bytes"] for index in indexes if index["name"] in optional
        ),
        "records": records,
        "summary": summary,
        "plans": plans,
    }


def save(path: Path, result: Record) -> None:
    temporary = path.with_suffix(".pending")
    temporary.write_text(json.dumps(result, indent=2) + "\n")
    temporary.replace(path)
