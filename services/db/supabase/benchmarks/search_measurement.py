"""Measure the final visible search/date/capped-amount contract on disposable clones."""

from __future__ import annotations

import json
import statistics
import time
from dataclasses import replace
from pathlib import Path
from typing import Any
from urllib.error import HTTPError

from .common import catalog_fingerprint, connect, digest, identities, synthetic_token
from .search_cases import SearchCase
from .table_verification import (
    AMOUNT_ERROR,
    AMOUNT_LIMIT,
    Payload,
    discover_cases,
    read_reference,
    read_rpc_page,
)
from .transport import request, rest_server

Record = dict[str, Any]


def assert_cap_rejected(base: str, token: str, case: SearchCase) -> None:
    try:
        request(base, case.dataset.endpoint, case.arguments(), token)
    except HTTPError as error:
        payload = json.loads(error.read())
        if (
            error.code != 400
            or payload.get("code") != "22023"
            or payload.get("message") != AMOUNT_ERROR
        ):
            raise RuntimeError("Amount cap returned an unexpected API error") from None
    else:
        raise RuntimeError("Broad amount ordering did not reject its over-limit scope")


def _sample(base: str, token: str, case: SearchCase, expected: Payload | None) -> Record:
    started = time.perf_counter()
    if case.expect_cap:
        assert_cap_rejected(base, token, case)
        return {
            "rejected": True,
            "rejection_ms": round((time.perf_counter() - started) * 1000, 3),
            "matching_rows_exceed": AMOUNT_LIMIT,
        }
    if expected is None:
        raise RuntimeError("Successful case has no correctness reference")
    payload, size = read_rpc_page(base, token, case)
    rows_ready = (time.perf_counter() - started) * 1000
    if payload != {"rows": expected["rows"], "total_count": None}:
        raise RuntimeError(f"Page differs from authorized view for {case.dataset.key} {case.name}")
    count_started = time.perf_counter()
    total, _ = request(base, case.count_endpoint, case.count_arguments(), token)
    count_ms = (time.perf_counter() - count_started) * 1000
    if total != expected["total_count"]:
        raise RuntimeError(f"Count differs from authorized view for {case.dataset.key} {case.name}")
    return {
        "rejected": False,
        "rows_ready_ms": round(rows_ready, 3),
        "count_request_ms": round(count_ms, 3),
        "all_ready_ms": round((time.perf_counter() - started) * 1000, 3),
        "rows": len(payload["rows"]),
        "matching_rows": int(expected["total_count"] or "0"),
        "page_bytes": size,
        "result_sha256": digest(expected),
    }


def measure(database: str, image: str, password: str, temporary: Path, repeat: int) -> Record:
    with connect(database, password) as connection:
        signatures = connection.execute(
            "select proname,pg_get_function_arguments(oid) from pg_proc "
            "where pronamespace='public'::regnamespace and proname in "
            "('transaction_page','transaction_count','source_transaction_page','source_transaction_count')"
        ).fetchall()
        if len(signatures) != 4 or not all(
            "p_search_skus text[]" in args for _, args in signatures
        ):
            raise RuntimeError("Install all four current table RPCs before benchmarking")
        before = catalog_fingerprint(connection)
        subjects = identities(connection)
        facts = connection.execute(
            "select (select count(*) from private.settlement_transactions),"
            "(select count(*) from private.data_kiosk_transactions)"
        ).fetchone()
        actor_cases = {role: discover_cases(connection, user) for role, user in subjects.items()}
        references = {
            (role, case.dataset.key, case.name): read_reference(connection, subjects[role], case)
            for role, selected in actor_cases.items()
            for case in selected
        }
    if facts is None:
        raise RuntimeError("Fixture has no fact counts")
    result: Record = {
        "database": database,
        "repeat": repeat,
        "warmups": 1,
        "settlement_facts": facts[0],
        "data_kiosk_facts": facts[1],
        "catalog_before": before,
        "records": [],
        "summary": [],
    }
    with rest_server(database, password, image, temporary) as (base, secret):
        tokens = {role: synthetic_token(secret, user) for role, user in subjects.items()}
        # Check filtered amount counts, both directions and the next page outside timing.
        with connect(database, password) as connection:
            for role, selected in actor_cases.items():
                for case in selected:
                    if case.name != "amount_filtered":
                        continue
                    for changed in (case, replace(case, direction="asc"), replace(case, offset=1)):
                        expected = read_reference(connection, subjects[role], changed)
                        actual, _ = read_rpc_page(base, tokens[role], changed, include_count=True)
                        if actual != expected:
                            raise RuntimeError(
                                "Filtered amount order/tie/pagination contract differs"
                            )
        for iteration in range(repeat + 1):
            roles = list(subjects)
            if iteration % 2:
                roles.reverse()
            for role in roles:
                selected = actor_cases[role]
                shift = iteration % len(selected)
                for case in selected[shift:] + selected[:shift]:
                    sample = _sample(
                        base, tokens[role], case, references[role, case.dataset.key, case.name]
                    )
                    result["records"].append(
                        {
                            "role": role,
                            "dataset": case.dataset.key,
                            "case": case.name,
                            "iteration": iteration,
                            "warmup": iteration == 0,
                            **sample,
                        }
                    )
            print(json.dumps({"fixture": database, "iteration_complete": iteration}), flush=True)
    for role, dataset, case in sorted(
        {(r["role"], r["dataset"], r["case"]) for r in result["records"]}
    ):
        selected = [
            r
            for r in result["records"]
            if not r["warmup"] and (r["role"], r["dataset"], r["case"]) == (role, dataset, case)
        ]
        result["summary"].append(
            {
                "role": role,
                "dataset": dataset,
                "case": case,
                "metrics": {
                    key: {
                        "median": round(statistics.median(r[key] for r in selected), 3),
                        "min": min(r[key] for r in selected),
                        "max": max(r[key] for r in selected),
                    }
                    for key in ("rows_ready_ms", "count_request_ms", "all_ready_ms", "rejection_ms")
                    if key in selected[0]
                },
            }
        )
    with connect(database, password) as connection:
        result["catalog_after"] = catalog_fingerprint(connection)
    if before != result["catalog_after"]:
        raise RuntimeError("Table measurements changed clone definitions")
    result["cases_verified"] = len(references)
    return result
