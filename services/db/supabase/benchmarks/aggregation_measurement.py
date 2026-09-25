"""Compare installed summary RPCs with generated REST aggregation on local clones."""

# HTTP targets come only from the guarded temporary REST server.
# ruff: noqa: S310
from __future__ import annotations

import csv
import io
import json
import statistics
import time
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, cast
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .common import catalog_fingerprint, connect, digest, identities, synthetic_token
from .transport import request, rest_server

Record = dict[str, Any]
SELECT_TOTALS = (
    "reported_amount:source_amount.sum(),service_fee:fee_amount.sum(),"
    "company_amount:company_amount.sum(),row_count:count(),"
    "known_company_count:company_amount.count()"
)
VISIBILITY = ("and", "(or(source.neq.DATA_KIOSK,source_amount.neq.0))")


@dataclass
class Case:
    name: str
    endpoint: str
    arguments: Record
    reference: str
    parameters: list[tuple[str, str]]
    option: bool = False


def _totals_case(name: str, start: date, end: date, *, by_type: bool = False) -> Case:
    groups = "component_type,currency" if by_type else "currency"
    parameters = [
        ("select", groups + "," + SELECT_TOTALS),
        ("order", "component_type.asc,currency.asc" if by_type else "currency.asc"),
        ("activity_date", "gte." + start.isoformat()),
        ("activity_date", "lte." + end.isoformat()),
        VISIBILITY,
    ]
    arguments: Record = {
        "p_date_from": start.isoformat(),
        "p_date_to": end.isoformat(),
        "p_group_by_type": by_type,
        "p_currency": "USD" if by_type else None,
    }
    if by_type:
        parameters.append(("currency", "eq.USD"))
    return Case(name, "transaction_totals", arguments, "live_company_components", parameters)


def _cases(latest: date, operator: bool) -> list[Case]:
    next_day = latest + timedelta(days=1)
    month_end = latest if next_day.day == 1 else latest.replace(day=1) - timedelta(days=1)
    month_start = month_end.replace(day=1)
    result = [
        _totals_case("latest_day", latest, latest),
        _totals_case("latest_month", month_start, month_end),
        _totals_case("month_types", month_start, month_end, by_type=True),
    ]
    scoped = _totals_case("month_marketplace", month_start, month_end)
    scoped.arguments["p_marketplaces"] = ["Amazon.com"]
    scoped.parameters.append(("marketplace_name", "eq.Amazon.com"))
    result.append(scoped)
    datasets = [
        ("live", "live_company_components", field)
        for field in ("sku", "marketplace_name", "source", "component_type")
    ]
    datasets.append(("fees", "current_sku_fee_periods", "marketplace_name"))
    if operator:
        datasets.extend(
            [
                ("settlement", "settlement_preprocess_entries", "sku"),
                ("data_kiosk", "data_kiosk_preprocess_entries", "component_type"),
            ]
        )
    for dataset, endpoint, field in datasets:
        params = [
            ("select", field + ",option_count:count()"),
            ("order", field + ".asc"),
            (field, "not.is.null"),
        ]
        if dataset == "live":
            params.append(VISIBILITY)
        elif dataset == "data_kiosk":
            params.append(("amount", "neq.0"))
        result.append(
            Case(
                f"options_{dataset}_{field}",
                "dataset_filter_options",
                {"p_dataset": dataset, "p_field": field},
                endpoint,
                params,
                True,
            )
        )
    return result


def _reference(base: str, bearer: str, case: Case) -> tuple[list[Record], int, int]:
    rows: list[Record] = []
    size = calls = covered = 0
    expected = None
    while True:
        parameters = [*case.parameters, ("limit", "1000"), ("offset", str(len(rows)))]
        headers = {"Authorization": "Bearer " + bearer, "Accept": "text/csv"}
        if expected is None:
            headers["Prefer"] = "count=exact"
        with urlopen(
            Request(base + "/" + case.reference + "?" + urlencode(parameters), headers=headers),
            timeout=30,
        ) as response:
            body = response.read()
            page = list(csv.DictReader(io.StringIO(body.decode())))
            if expected is None:
                expected = int(response.headers["Content-Range"].rsplit("/", 1)[1])
        calls += 1
        size += len(body)
        covered += sum(int(row["option_count" if case.option else "row_count"]) for row in page)
        rows.extend(page)
        if covered == expected:
            return rows, size, calls
        if not page or covered > expected:
            raise RuntimeError("Reference aggregate pagination did not cover its source count")


def _rpc(base: str, bearer: str, case: Case) -> tuple[list[Any], int, int]:
    rows: list[Any] = []
    size = calls = 0
    arguments = {
        **case.arguments,
        "p_limit": 1000,
        ("p_after" if case.option else "p_offset"): None if case.option else 0,
    }
    while True:
        value, page_bytes = request(base, case.endpoint, arguments, bearer)
        if not isinstance(value, dict):
            raise RuntimeError("RPC returned an invalid envelope")
        envelope = cast(Record, value)
        raw_page = envelope["values" if case.option else "rows"]
        if not isinstance(raw_page, list):
            raise RuntimeError("RPC returned an invalid bounded page")
        page = cast(list[Any], raw_page)
        if len(page) > 1000:
            raise RuntimeError("RPC returned an oversized page")
        rows.extend(page)
        size += page_bytes
        calls += 1
        following = envelope["next_cursor" if case.option else "next_offset"]
        if following is None:
            return rows, size, calls
        if not page or (case.option and following != page[-1]):
            raise RuntimeError("RPC pagination did not advance")
        if not case.option and following != len(rows):
            raise RuntimeError("RPC offset is inconsistent")
        arguments["p_after" if case.option else "p_offset"] = following


def _canonical(rows: list[Any], case: Case, strategy: str) -> list[Any]:
    if case.option:
        values = [row[case.arguments["p_field"]] for row in rows] if strategy == "rest" else rows
        if len(values) != len(set(values)):
            raise RuntimeError("Duplicate options")
        return sorted(values)
    result: list[list[Any]] = []
    for row in rows:
        entry: list[Any] = [row["currency"], row.get("component_type") or None]
        for key in ("reported_amount", "service_fee", "company_amount"):
            if row[key] in (None, ""):
                entry.append(None)
            else:
                number = Decimal(row[key])
                exact = format(number, "f")
                if "." in exact:
                    exact = exact.rstrip("0").rstrip(".")
                entry.append("0" if number == 0 else exact)
        entry.extend(int(row[key]) for key in ("row_count", "known_company_count"))
        result.append(entry)
    return sorted(result, key=lambda row: (row[0], row[1] or ""))


def measure(database: str, image: str, password: str, temporary: Path, repeat: int) -> Record:
    with connect(database, password) as connection:
        before = catalog_fingerprint(connection)
        users = identities(connection)
        counts = connection.execute(
            "select (select count(*) from private.settlement_transactions),"
            "(select count(*) from private.data_kiosk_transactions)"
        ).fetchone()
        if counts is None:
            raise RuntimeError("Missing fixture metadata")
    records: list[Record] = []
    cases_by_role: dict[str, list[Case]] = {}
    with rest_server(database, password, image, temporary, aggregates_enabled=True) as (
        base,
        secret,
    ):
        for role, user in users.items():
            bearer = synthetic_token(secret, user)
            latest_value, _ = request(
                base,
                "transaction_page",
                {
                    "p_limit": 1,
                    "p_include_count": False,
                    "p_direction": "desc",
                },
                bearer,
            )
            if not isinstance(latest_value, dict):
                raise RuntimeError("Latest-date discovery returned an invalid envelope")
            latest = date.fromisoformat(cast(Record, latest_value)["rows"][0]["activity_date"])
            cases_by_role[role] = _cases(latest, role == "operator")
            for case in cases_by_role[role]:
                reference = None
                for iteration in range(repeat + 1):
                    for strategy in ("rest", "rpc") if iteration % 2 == 0 else ("rpc", "rest"):
                        start = time.perf_counter()
                        rows, size, calls = (_reference if strategy == "rest" else _rpc)(
                            base, bearer, case
                        )
                        elapsed = (time.perf_counter() - start) * 1000
                        canonical = _canonical(rows, case, strategy)
                        if reference is None:
                            reference = canonical
                        if canonical != reference:
                            raise RuntimeError(f"Unequal {role} {case.name} {strategy} result")
                        records.append(
                            {
                                "role": role,
                                "case": case.name,
                                "strategy": strategy,
                                "iteration": iteration,
                                "warmup": iteration == 0,
                                "elapsed_ms": round(elapsed, 3),
                                "groups": len(rows),
                                "response_bytes": size,
                                "requests": calls,
                                "result_sha256": digest(canonical),
                            }
                        )
                print(
                    json.dumps({"measured": database, "role": role, "case": case.name}), flush=True
                )
    with rest_server(database, password, image, temporary) as (base, secret):
        bearer = synthetic_token(secret, users["member_a"])
        try:
            _reference(base, bearer, cases_by_role["member_a"][0])
        except HTTPError as error:
            rejected = error.code == 400 and json.loads(error.read())["code"] == "PGRST123"
        else:
            rejected = False
        if not rejected:
            raise RuntimeError("REST aggregates were not disabled")
        for case in cases_by_role["member_a"]:
            _rpc(base, bearer, case)
    with connect(database, password) as connection:
        after = catalog_fingerprint(connection)
    if before != after:
        raise RuntimeError("Measurement changed clone definitions")
    summary: list[Record] = []
    for role, case, strategy in sorted({(r["role"], r["case"], r["strategy"]) for r in records}):
        samples = [
            r["elapsed_ms"]
            for r in records
            if not r["warmup"] and (r["role"], r["case"], r["strategy"]) == (role, case, strategy)
        ]
        summary.append(
            {
                "role": role,
                "case": case,
                "strategy": strategy,
                "median_ms": statistics.median(samples),
                "min_ms": min(samples),
                "max_ms": max(samples),
            }
        )
    return {
        "database": database,
        "settlement_facts": counts[0],
        "data_kiosk_facts": counts[1],
        "repeat": repeat,
        "warmups": 1,
        "records": records,
        "summary": summary,
        "rest_aggregation_disabled_verified": True,
        "catalog_before": before,
        "catalog_after": after,
    }
