"""Equivalent authenticated query cases and paired SKU latency measurements."""

from __future__ import annotations

import json
import statistics
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal, cast

from psycopg import sql

from services.db.supabase.tests.local_database import require_row

from .common import Connection
from .sku_comparison_data import ComparisonData

WARMUP_ROUNDS = 3
_INTERNAL_IDS = {"sku_id", "seller_sku_id", "terms_version_id", "fee_period_id"}
_NUMERIC_FIELDS = {
    "source_amount",
    "reported_amount",
    "fee_amount",
    "service_fee",
    "company_amount",
    "quantity",
    "fee_base",
    "fee_rate_percent",
}


@dataclass(frozen=True)
class QueryCase:
    name: str
    actor: Literal["member", "operator"]
    rpc: str
    arguments: dict[str, Any]


def comparison_cases(data: ComparisonData) -> list[QueryCase]:
    period = {"p_date_from": data.date_from, "p_date_to": data.date_to}
    selected = {**period, "p_skus": [data.selected_sku]}
    company = {**period, "p_company_ids": [data.company_id]}
    page = {"p_limit": 25, "p_include_count": False}
    return [
        QueryCase("member_count_all", "member", "transaction_count", {}),
        QueryCase("member_count_period", "member", "transaction_count", period),
        QueryCase("member_count_sku", "member", "transaction_count", selected),
        QueryCase("member_page_latest", "member", "transaction_page", page),
        QueryCase("member_page_period", "member", "transaction_page", {**period, **page}),
        QueryCase("member_page_sku", "member", "transaction_page", {**selected, **page}),
        QueryCase("member_totals_period", "member", "transaction_totals", period),
        QueryCase("member_totals_sku", "member", "transaction_totals", selected),
        QueryCase(
            "member_type_totals",
            "member",
            "transaction_totals",
            {**period, "p_group_by_type": True},
        ),
        QueryCase("operator_company_count", "operator", "transaction_count", company),
        QueryCase("operator_company_page", "operator", "transaction_page", {**company, **page}),
        QueryCase("operator_company_totals", "operator", "transaction_totals", company),
        QueryCase("operator_all_totals", "operator", "transaction_totals", period),
    ]


def _normalize_result(value: object, field: str = "") -> object:
    """Compare visible row order and exact numbers, excluding internal terms IDs."""
    if isinstance(value, dict):
        return {
            key: _normalize_result(item, key)
            for key, item in cast(dict[str, object], value).items()
            if key not in _INTERNAL_IDS
        }
    if isinstance(value, list):
        return [_normalize_result(item) for item in cast(list[object], value)]
    if field in _NUMERIC_FIELDS and value is not None:
        return Decimal(str(value))
    return value


def _rpc_statement(case: QueryCase) -> sql.Composed:
    arguments: list[sql.Composable] = []
    for name in case.arguments:
        cast_type = "::uuid[]" if name == "p_company_ids" else ""
        arguments.append(sql.SQL("{} => %s{}").format(sql.Identifier(name), sql.SQL(cast_type)))
    return sql.SQL("select public.{}({})").format(
        sql.Identifier(case.rpc), sql.SQL(", ").join(arguments)
    )


def _read_case(connection: Connection, user: str, case: QueryCase) -> tuple[Any, float]:
    with connection.transaction():
        connection.execute("set transaction read only")
        connection.execute("set local statement_timeout='60s'")
        connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
        connection.execute("set local role authenticated")
        statement = _rpc_statement(case)
        parameters = list(case.arguments.values())
        started = time.perf_counter()
        result = require_row(connection.execute(statement, parameters, prepare=False).fetchone())[0]
        milliseconds = (time.perf_counter() - started) * 1000
    return _normalize_result(result), milliseconds


def _summarize_samples(samples: list[float]) -> dict[str, Any]:
    quartiles = statistics.quantiles(samples, n=4, method="inclusive")
    return {
        "median_ms": round(statistics.median(samples), 3),
        "p25_ms": round(quartiles[0], 3),
        "p75_ms": round(quartiles[2], 3),
        "minimum_ms": round(min(samples), 3),
        "maximum_ms": round(max(samples), 3),
        "samples_ms": [round(value, 3) for value in samples],
    }


def measure_comparison(
    connections: dict[str, Connection], data: ComparisonData, cases: list[QueryCase], repeat: int
) -> list[dict[str, Any]]:
    samples: dict[str, dict[str, list[float]]] = {
        case.name: {"before": [], "after": []} for case in cases
    }
    case_order = {case.name: position for position, case in enumerate(cases)}
    references: dict[str, Any] = {}
    for iteration in range(repeat + WARMUP_ROUNDS):
        rotation = iteration % len(cases)
        for case in cases[rotation:] + cases[:rotation]:
            variants = (
                ("before", "after")
                if (iteration + case_order[case.name]) % 2 == 0
                else ("after", "before")
            )
            for variant in variants:
                value, elapsed = _read_case(connections[variant], data.actor_id(case.actor), case)
                if case.name not in references:
                    references[case.name] = value
                elif value != references[case.name]:
                    raise AssertionError("Before/after results differ: " + case.name)
                if iteration >= WARMUP_ROUNDS:
                    samples[case.name][variant].append(elapsed)
        completed = max(0, iteration + 1 - WARMUP_ROUNDS)
        if iteration == WARMUP_ROUNDS - 1 or (completed and completed % 5 == 0):
            print(
                json.dumps(
                    {
                        "warmup_complete": iteration >= WARMUP_ROUNDS - 1,
                        "measured_rounds_completed": completed,
                    }
                ),
                flush=True,
            )
    results: list[dict[str, Any]] = []
    for case in cases:
        before, after = samples[case.name]["before"], samples[case.name]["after"]
        old, new = statistics.median(before), statistics.median(after)
        value = references[case.name]
        rows = len(cast(list[object], value["rows"])) if isinstance(value, dict) else int(value)
        results.append(
            {
                "case": case.name,
                "rpc": case.rpc,
                "actor": case.actor,
                "returned_rows_or_count": rows,
                "results_equivalent": True,
                "before": _summarize_samples(before),
                "after": _summarize_samples(after),
                "median_latency_reduction_percent": round(100 * (1 - new / old), 2),
                "ratio_of_median_times": round(old / new, 3),
                "median_paired_speedup": round(
                    statistics.median(
                        left / right for left, right in zip(before, after, strict=True)
                    ),
                    3,
                ),
            }
        )
    return results
