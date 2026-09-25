"""Compare current combined versus sequential page/count RPC responses and timings."""

from __future__ import annotations

import json
import statistics
import time
from collections.abc import Mapping
from datetime import date, timedelta
from pathlib import Path
from typing import Any, TypedDict, cast

from .common import Connection, catalog_fingerprint, connect, digest, identities, synthetic_token
from .transport import request, rest_server


class Payload(TypedDict):
    rows: list[dict[str, Any]]
    total_count: str | None


class Case(TypedDict):
    name: str
    filters: dict[str, object]
    direction: str


Record = dict[str, Any]
METRICS = ("rows_ready_ms", "count_request_ms", "all_ready_ms")


def _page(base: str, options: Mapping[str, object], bearer: str) -> tuple[Payload, int]:
    payload, size = request(base, "transaction_page", options, bearer)
    if not isinstance(payload, dict):
        raise RuntimeError("Installed page RPC returned an invalid response")
    if not isinstance(cast(dict[str, object], payload).get("rows"), list):
        raise RuntimeError("Installed page RPC returned an invalid response")
    return cast(Payload, payload), size


def _metadata(connection: Connection, repeat: int) -> Record:
    signatures = connection.execute(
        "select proname,pg_get_function_arguments(oid) from pg_proc "
        "where pronamespace='public'::regnamespace "
        "and proname in ('transaction_page','transaction_count') order by proname"
    ).fetchall()
    if len(signatures) != 2 or not all(
        "p_marketplaces amazon_marketplace_name[]" in arguments
        and "p_fee_applicable boolean" in arguments
        and "p_search text" in arguments
        and "p_sort " not in arguments
        and (name != "transaction_page" or "p_order_by text" in arguments)
        for name, arguments in signatures
    ):
        raise RuntimeError(
            "Install the current date/amount, fee-filterable RPCs before benchmarking"
        )
    counts = connection.execute(
        "select (select count(*) from private.settlement_transactions),"
        "(select count(*) from private.data_kiosk_transactions),"
        "(select count(*) from public.companies),"
        "(select count(*) from private.settlements),"
        "(select count(*) from private.data_kiosk_days)"
    ).fetchone()
    if counts is None:
        raise RuntimeError("Missing fixture counts")
    settings = {}
    for key in (
        "server_version",
        "shared_buffers",
        "work_mem",
        "jit",
        "max_parallel_workers_per_gather",
    ):
        row = connection.execute("select current_setting(%s)", (key,)).fetchone()
        if row is None:
            raise RuntimeError("Missing database setting")
        settings[key] = row[0]
    visibility = connection.execute(
        "select relname,relpages,relallvisible from pg_class where oid in "
        "('private.settlement_transactions'::regclass,'private.data_kiosk_transactions'::regclass) "
        "order by relname"
    ).fetchall()
    return {
        "counts": dict(
            zip(
                (
                    "settlement_facts",
                    "kiosk_facts",
                    "companies",
                    "settlement_headers",
                    "kiosk_headers",
                ),
                counts,
                strict=True,
            )
        ),
        "settings": settings,
        "fact_visibility": visibility,
        "repeat": repeat,
        "warmups": 1,
        "catalog_before": catalog_fingerprint(connection),
        "records": [],
        "summary": [],
    }


def _cases(base: str, bearer: str) -> list[Case]:
    first, _ = _page(base, {"p_limit": 25, "p_include_count": False}, bearer)
    if not first["rows"]:
        raise RuntimeError("Benchmark identity has no visible transactions")
    latest = date.fromisoformat(first["rows"][0]["activity_date"])
    marketplace = next(row["marketplace_name"] for row in first["rows"] if row["marketplace_name"])
    return [
        {"name": "latest", "filters": {}, "direction": "desc"},
        {"name": "oldest", "filters": {}, "direction": "asc"},
        {
            "name": "one_marketplace",
            "filters": {"p_marketplaces": [marketplace]},
            "direction": "desc",
        },
        {
            "name": "latest_ten_dates",
            "filters": {
                "p_date_from": (latest - timedelta(days=9)).isoformat(),
                "p_date_to": latest.isoformat(),
            },
            "direction": "desc",
        },
    ]


def _sample(base: str, case: Case, bearer: str, reference: Payload) -> Record:
    started = time.perf_counter()
    payload, page_bytes = _page(
        base,
        {
            **case["filters"],
            "p_limit": 25,
            "p_direction": case["direction"],
            "p_include_count": False,
        },
        bearer,
    )
    rows_ready = (time.perf_counter() - started) * 1000
    count_started = time.perf_counter()
    total, count_bytes = request(base, "transaction_count", case["filters"], bearer)
    completed = (time.perf_counter() - started) * 1000
    count_duration = (time.perf_counter() - count_started) * 1000
    if payload["total_count"] is not None or not isinstance(total, str) or not total.isdecimal():
        raise RuntimeError("Installed RPCs returned invalid exact-count semantics")
    if {"rows": payload["rows"], "total_count": total} != reference:
        raise RuntimeError("Separate page/count results differ from the combined installed RPC")
    return {
        "rows_ready_ms": round(rows_ready, 3),
        "count_request_ms": round(count_duration, 3),
        "all_ready_ms": round(completed, 3),
        "rows": len(payload["rows"]),
        "response_bytes": page_bytes + count_bytes,
        "result_sha256": digest(reference),
    }


def _run_samples(base: str, tokens: dict[str, str], repeat: int, result: Record) -> None:
    cases = {role: _cases(base, bearer) for role, bearer in tokens.items()}
    references: dict[tuple[str, str], Payload] = {}
    for role, selected in cases.items():
        for case in selected:
            references[role, case["name"]], _ = _page(
                base,
                {
                    **case["filters"],
                    "p_limit": 25,
                    "p_direction": case["direction"],
                    "p_include_count": True,
                },
                tokens[role],
            )
    for iteration in range(repeat + 1):
        roles = list(tokens)
        if iteration % 2:
            roles.reverse()
        for role in roles:
            selected = cases[role]
            shift = iteration % len(selected)
            for case in selected[shift:] + selected[:shift]:
                sample = _sample(base, case, tokens[role], references[role, case["name"]])
                result["records"].append(
                    {
                        "role": role,
                        "case": case["name"],
                        "iteration": iteration,
                        "warmup": iteration == 0,
                        **sample,
                    }
                )
        print(
            json.dumps(
                {
                    "fixture": result["database"],
                    "iteration_complete": iteration,
                    "measured": iteration > 0,
                }
            ),
            flush=True,
        )
    for role, selected in cases.items():
        for case in selected:
            measured = [
                record
                for record in result["records"]
                if record["role"] == role
                and record["case"] == case["name"]
                and not record["warmup"]
            ]
            metrics = {
                field: {
                    "median": round(statistics.median(record[field] for record in measured), 3),
                    "min": min(record[field] for record in measured),
                    "max": max(record[field] for record in measured),
                }
                for field in METRICS
            }
            result["summary"].append({"role": role, "case": case["name"], "metrics": metrics})
            print(
                json.dumps(
                    {
                        "fixture": result["database"],
                        "role": role,
                        "case": case["name"],
                        "medians": {key: value["median"] for key, value in metrics.items()},
                    }
                ),
                flush=True,
            )


def measure(database: str, image: str, password: str, temporary: Path, repeat: int) -> Record:
    with connect(database, password) as connection:
        result = _metadata(connection, repeat)
        result["database"] = database
        subjects = identities(connection)
    with rest_server(database, password, image, temporary) as (base, secret):
        tokens = {role: synthetic_token(secret, user) for role, user in subjects.items()}
        _run_samples(base, tokens, repeat, result)
    with connect(database, password) as connection:
        result["catalog_after"] = catalog_fingerprint(connection)
    if result["catalog_before"] != result["catalog_after"]:
        raise RuntimeError("Benchmark changed the clone catalog")
    return result
