"""Current summary/option RPC timings with independent authorized SQL references."""

from __future__ import annotations

import json
import statistics
import time
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, cast

from psycopg import sql

from .common import Connection, catalog_fingerprint, connect, digest, identities, synthetic_token
from .transport import request, rest_server

Record = dict[str, Any]


@dataclass(frozen=True)
class Case:
    name: str
    endpoint: str
    arguments: Record
    relation: str = "live_company_components"
    field: str | None = None


def _cases(latest: date, marketplace: str, currency: str) -> list[Case]:
    month_end = (
        latest
        if (latest + timedelta(days=1)).day == 1
        else latest.replace(day=1) - timedelta(days=1)
    )
    month = {
        "p_date_from": month_end.replace(day=1).isoformat(),
        "p_date_to": month_end.isoformat(),
    }
    cases = [
        Case(
            "latest_day",
            "transaction_totals",
            {"p_date_from": latest.isoformat(), "p_date_to": latest.isoformat()},
        ),
        Case("latest_month", "transaction_totals", month),
        Case(
            "month_types",
            "transaction_totals",
            {**month, "p_group_by_type": True, "p_currency": currency},
        ),
        Case("month_marketplace", "transaction_totals", {**month, "p_marketplaces": [marketplace]}),
    ]
    for dataset, relation, fields in (
        (
            "live",
            "live_company_components",
            ("sku", "marketplace_name", "source", "component_type"),
        ),
        ("settlement", "settlement_preprocess_entries", ("sku",)),
        ("data_kiosk", "data_kiosk_preprocess_entries", ("component_type",)),
    ):
        cases.extend(
            Case(
                f"options_{dataset}_{field}",
                "dataset_filter_options",
                {"p_dataset": dataset, "p_field": field},
                relation,
                field,
            )
            for field in fields
        )
    return cases


def _reference(connection: Connection, case: Case) -> list[Any]:
    if case.field is not None:
        visibility = {
            "live": sql.SQL("(source <> 'DATA_KIOSK' or source_amount <> 0)"),
            "settlement": sql.SQL("true"),
            "data_kiosk": sql.SQL("amount <> 0"),
        }[case.arguments["p_dataset"]]
        rows = connection.execute(
            sql.SQL(
                'select distinct {field} collate "C" as value from public.{relation} '
                "where {field} is not null and {visibility} order by value"
            ).format(
                field=sql.Identifier(case.field),
                relation=sql.Identifier(case.relation),
                visibility=visibility,
            )
        ).fetchall()
        return [row[0] for row in rows]
    grouped = case.arguments.get("p_group_by_type", False)
    query = sql.SQL(
        "select currency,{kind} as component_type,sum(source_amount)::text as reported_amount,"
        "sum(fee_amount)::text as service_fee,sum(company_amount)::text as company_amount,"
        "count(*)::text as row_count,count(company_amount)::text as known_company_count "
        "from public.live_company_components "
        "where (source <> 'DATA_KIOSK' or source_amount <> 0) "
        "and activity_date between %s::date and %s::date "
        "and (%s::text is null or currency=%s::text) "
        "and (%s::text[] is null or marketplace_name=any(%s::text[])) "
        "group by currency{group}"
    ).format(
        kind=sql.SQL("component_type" if grouped else "null::text"),
        group=sql.SQL(",component_type" if grouped else ""),
    )
    rows = connection.execute(
        query,
        (
            case.arguments["p_date_from"],
            case.arguments["p_date_to"],
            case.arguments.get("p_currency"),
            case.arguments.get("p_currency"),
            case.arguments.get("p_marketplaces"),
            case.arguments.get("p_marketplaces"),
        ),
    ).fetchall()
    fields = (
        "currency",
        "component_type",
        "reported_amount",
        "service_fee",
        "company_amount",
        "row_count",
        "known_company_count",
    )
    return [dict(zip(fields, row, strict=True)) for row in rows]


def _discover(connection: Connection, user: str) -> tuple[list[Case], dict[str, list[Any]]]:
    with connection.transaction():
        connection.execute("set transaction read only")
        connection.execute("set local role authenticated")
        connection.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (json.dumps({"sub": user, "role": "authenticated"}),),
        )
        scope = connection.execute(
            "select max(activity_date),min(marketplace_name),min(currency) "
            "from public.live_company_components "
            "where source <> 'DATA_KIOSK' or source_amount <> 0"
        ).fetchone()
        if scope is None or any(value is None for value in scope):
            raise RuntimeError("Summary benchmark identity has no visible transaction scope")
        cases = _cases(scope[0], scope[1], scope[2])
        return cases, {case.name: _canonical(_reference(connection, case), case) for case in cases}


def _rpc(base: str, bearer: str, case: Case) -> tuple[list[Any], int, int]:
    rows: list[Any] = []
    size = calls = 0
    option = case.field is not None
    arguments = {
        **case.arguments,
        "p_limit": 1000,
        "p_after" if option else "p_offset": None if option else 0,
    }
    while True:
        value, page_bytes = request(base, case.endpoint, arguments, bearer)
        if not isinstance(value, dict):
            raise RuntimeError("RPC returned an invalid envelope")
        envelope = cast(Record, value)
        raw_page = envelope["values" if option else "rows"]
        if not isinstance(raw_page, list):
            raise RuntimeError("RPC returned an invalid bounded page")
        page = cast(list[Any], raw_page)
        if len(page) > 1000:
            raise RuntimeError("RPC returned an oversized page")
        rows.extend(page)
        size += page_bytes
        calls += 1
        following = envelope["next_cursor" if option else "next_offset"]
        if following is None:
            return rows, size, calls
        if not page or (option and following != page[-1]):
            raise RuntimeError("RPC pagination did not advance")
        if not option and following != len(rows):
            raise RuntimeError("RPC offset is inconsistent")
        arguments["p_after" if option else "p_offset"] = following


def _canonical(rows: list[Any], case: Case) -> list[Any]:
    if case.field is not None:
        if any(not isinstance(value, str) for value in rows) or len(rows) != len(set(rows)):
            raise RuntimeError("Option values must be unique strings")
        return rows
    result: list[list[Any]] = []
    for row in rows:
        entry: list[Any] = [row["currency"], row.get("component_type")]
        for key in ("reported_amount", "service_fee", "company_amount"):
            if row[key] is None:
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
        scopes = {role: _discover(connection, user) for role, user in users.items()}
    records: list[Record] = []
    with rest_server(database, password, image, temporary) as (base, secret):
        tokens = {role: synthetic_token(secret, user) for role, user in users.items()}
        for iteration in range(repeat + 1):
            roles = list(users) if iteration % 2 == 0 else list(reversed(users))
            for role in roles:
                cases, references = scopes[role]
                shift = iteration % len(cases)
                for case in cases[shift:] + cases[:shift]:
                    start = time.perf_counter()
                    rows, size, calls = _rpc(base, tokens[role], case)
                    elapsed = (time.perf_counter() - start) * 1000
                    canonical = _canonical(rows, case)
                    if canonical != references[case.name]:
                        raise RuntimeError(
                            f"Summary differs from authorized view for {role} {case.name}"
                        )
                    records.append(
                        {
                            "role": role,
                            "case": case.name,
                            "iteration": iteration,
                            "warmup": iteration == 0,
                            "elapsed_ms": round(elapsed, 3),
                            "groups": len(rows),
                            "response_bytes": size,
                            "requests": calls,
                            "result_sha256": digest(canonical),
                        }
                    )
            print(json.dumps({"fixture": database, "iteration_complete": iteration}), flush=True)
    with connect(database, password) as connection:
        after = catalog_fingerprint(connection)
    if before != after:
        raise RuntimeError("Measurement changed clone definitions")
    summary: list[Record] = []
    for role, case in sorted({(record["role"], record["case"]) for record in records}):
        samples = [
            record["elapsed_ms"]
            for record in records
            if not record["warmup"] and (record["role"], record["case"]) == (role, case)
        ]
        summary.append(
            {
                "role": role,
                "case": case,
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
        "catalog_before": before,
        "catalog_after": after,
    }
