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
    is_sku_catalog: bool = False


def _cases(latest: date, marketplace: str, currency: str, *, include_skus: bool) -> list[Case]:
    month_end = (
        latest
        if (latest + timedelta(days=1)).day == 1
        else latest.replace(day=1) - timedelta(days=1)
    )
    month = {
        "p_date_from": month_end.replace(day=1).isoformat(),
        "p_date_to": month_end.isoformat(),
    }
    recent = {
        "p_date_from": (latest - timedelta(days=59)).isoformat(),
        "p_date_to": latest.isoformat(),
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
        Case("sixty_days", "transaction_totals", recent),
        Case(
            "sixty_day_types",
            "transaction_totals",
            {**recent, "p_group_by_type": True, "p_currency": currency},
        ),
    ]
    if include_skus:
        cases.append(Case("options_all_skus", "sku_filter_options", {}, is_sku_catalog=True))
    return cases


def _reference(connection: Connection, case: Case) -> list[Any]:
    if case.is_sku_catalog:
        operator = connection.execute("select private.is_operator()").fetchone()
        if operator != (True,):
            raise PermissionError("SKU catalog references require an application administrator")
        rows = connection.execute(
            'select distinct sku collate "C" as value from ('
            "select sku from private.settlement_transactions union all "
            "select sku from private.data_kiosk_transactions union all "
            "select sku from public.skus) inventory "
            "where sku is not null order by value"
        ).fetchall()
        return [row[0] for row in rows]
    grouped = case.arguments.get("p_group_by_type", False)
    query = sql.SQL(
        "select currency,{kind} as component_type,sum(source_amount)::text as reported_amount,"
        "sum(fee_amount)::text as service_fee,sum(company_amount)::text as company_amount,"
        "count(*)::text as row_count,count(company_amount)::text as known_company_count "
        "from public.live_company_components "
        "where authoritative "
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
        latest_row = connection.execute(
            "select max(activity_date) from public.live_company_components where authoritative"
        ).fetchone()
        if latest_row is None or latest_row[0] is None:
            raise RuntimeError("Summary benchmark identity has no visible transaction scope")
        latest = latest_row[0]
        scope = connection.execute(
            "select marketplace_name,currency from public.live_company_components "
            "where authoritative "
            "and marketplace_name is not null and activity_date between %s and %s "
            "group by marketplace_name,currency order by count(*) desc,marketplace_name,currency "
            "limit 1",
            (latest - timedelta(days=59), latest),
        ).fetchone()
        if scope is None:
            raise RuntimeError("Summary benchmark needs a marketplace in the selected period")
        account = connection.execute(
            "select access_role from public.app_accounts where user_id=auth.uid()"
        ).fetchone()
        cases = _cases(
            latest,
            scope[0],
            scope[1],
            include_skus=account is not None and account[0] == "operator",
        )
        return cases, {case.name: _canonical(_reference(connection, case), case) for case in cases}


def _rpc(base: str, bearer: str, case: Case) -> tuple[list[Any], int, int]:
    if case.is_sku_catalog:
        value, size = request(base, case.endpoint, {}, bearer)
        if not isinstance(value, dict):
            raise RuntimeError("SKU catalog RPC returned an invalid complete envelope")
        catalog = cast(Record, value)
        if set(catalog) != {"values"}:
            raise RuntimeError("SKU catalog RPC returned an invalid complete envelope")
        values = catalog["values"]
        if not isinstance(values, list):
            raise RuntimeError("SKU catalog RPC returned an invalid value list")
        return cast(list[Any], values), size, 1
    rows: list[Any] = []
    size = calls = 0
    arguments = {**case.arguments, "p_limit": 1000, "p_offset": 0}
    while True:
        value, page_bytes = request(base, case.endpoint, arguments, bearer)
        if not isinstance(value, dict):
            raise RuntimeError("RPC returned an invalid envelope")
        envelope = cast(Record, value)
        raw_page = envelope["rows"]
        if not isinstance(raw_page, list):
            raise RuntimeError("RPC returned an invalid bounded page")
        page = cast(list[Any], raw_page)
        if len(page) > 1000:
            raise RuntimeError("RPC returned an oversized page")
        rows.extend(page)
        size += page_bytes
        calls += 1
        following = envelope["next_offset"]
        if following is None:
            return rows, size, calls
        if not page or following != len(rows):
            raise RuntimeError("RPC offset is inconsistent")
        arguments["p_offset"] = following


def _canonical(rows: list[Any], case: Case) -> list[Any]:
    if case.is_sku_catalog:
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
                            "date_from": case.arguments.get("p_date_from"),
                            "date_to": case.arguments.get("p_date_to"),
                            "matching_rows": None
                            if case.is_sku_catalog
                            else sum(int(row["row_count"]) for row in rows),
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
