"""Read-only, sanitized EXPLAIN adapter for installed table/summary RPC SELECTs.

Call explain_rpc(connection, user_id, function_name, arguments) on an idle
psycopg connection after timing rounds. This does not measure timings, change
planner settings, inspect credentials, modify schemas/data, or retain arguments.
Guarded catalog plans first invoke the actual RPC under the requested actor; that
untimed authorization check prevents explaining a SELECT the caller cannot use.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator, Mapping, Sequence
from typing import Any, LiteralString, cast

from psycopg.pq import TransactionStatus

from .common import Connection

Query = tuple[str, list[object]]

_ALLOWED = {
    "transaction_page",
    "source_transaction_page",
    "transaction_count",
    "source_transaction_count",
    "transaction_totals",
    "sku_filter_options",
}


def _walk(node: dict[str, Any]) -> Iterator[dict[str, Any]]:
    yield node
    for child in node.get("Plans", []):
        yield from _walk(child)


def _format_body(definition: str, replacements: tuple[str, ...]) -> str:
    match = re.search(r"execute format\(\$query\$(.*?)\$query\$", definition, re.S)
    if match is None:
        raise ValueError("Installed dynamic query template was not found")

    def substitute(match: re.Match[str]) -> str:
        value = replacements[int(match.group(1)) - 1]
        return '"' + value.replace('"', '""') + '"' if match.group(2) == "I" else value

    return re.sub(r"%(\d+)\$([sI])", substitute, match.group(1))


def _bind_positions(body: str, typed_values: Sequence[tuple[str, object]]) -> Query:
    values: list[object] = []

    def bind(match: re.Match[str]) -> str:
        kind, value = typed_values[int(match.group(1)) - 1]
        values.append(value)
        return "(%s::" + kind + ")"

    return re.sub(r"\$(\d+)", bind, body), values


def _bind_names(body: str, typed_values: Mapping[str, tuple[str, object]]) -> Query:
    values: list[object] = []

    def bind(match: re.Match[str]) -> str:
        kind, value = typed_values[match.group(0)]
        values.append(value)
        return "(%s::" + kind + ")"

    tokens = re.compile(r"\b(" + "|".join(sorted(typed_values, key=len, reverse=True)) + r")\b")
    return tokens.sub(bind, body), values


def _uses_marketplace_candidates(definition: str, args: dict[str, Any]) -> bool:
    """Read the current function's work budget; never assume a historical template."""
    budget = re.search(
        r"\bmarketplace_candidate_budget\s+constant\s+bigint\s*:=\s*(\d+)\s*;",
        definition,
    )
    if budget is None:
        raise ValueError("Install the current marketplace page functions before explaining")
    marketplaces = args.get("p_marketplaces")
    return (
        args.get("p_order_by", "date") == "date"
        and marketplaces is not None
        and len(marketplaces) > 1
        and args.get("p_offset", 0) + args.get("p_limit", 25) <= int(budget[1]) // len(marketplaces)
    )


def _marketplace_page_parts(
    bounded: bool, direction: str, nulls: str, tie: str
) -> tuple[str, str, str]:
    if not bounded:
        return (
            "",
            """case when cardinality($5::text[]) = 1
                then t.marketplace_name = ($5::text[])[array_lower($5::text[], 1)]
                else coalesce(cardinality($5::text[]), 0) = 0
                    or t.marketplace_name = any($5)
                end""",
            "",
        )
    return (
        """select market_page.*
        from (select distinct marketplace_name
              from unnest($5::text[]) as requested_marketplaces(marketplace_name))
              selected_marketplaces
        cross join lateral (""",
        "t.marketplace_name = selected_marketplaces.marketplace_name",
        ") as market_page "
        f"order by activity_date {direction} nulls {nulls}, source {tie}, source_row_id {tie} "
        "limit $8::bigint",
    )


def _source_candidate_query(
    bounded: bool, amount: bool, date: str, direction: str, nulls: str, tie: str
) -> str:
    if not bounded:
        return (
            "select t.* from matching as t limit 10001"
            if amount
            else "select t.* from matching as t"
        )
    # Only validated identifiers/order keywords are interpolated; filters stay parameters.
    return f"""select market_page.*
        from (select distinct marketplace_name
              from unnest($4::text[]) as requested_marketplaces(marketplace_name))
              selected_marketplaces
        cross join lateral (
            select t.* from matching as t
            where t.marketplace_name = selected_marketplaces.marketplace_name
            order by t.{date} {direction} nulls {nulls}, t.id {tie}
            limit ($6::bigint + $7::bigint)
        ) as market_page
        order by market_page.{date} {direction} nulls {nulls}, market_page.id {tie}
        limit ($6::bigint + $7::bigint)"""  # noqa: S608


def _page_query(definition: str, function: str, args: dict[str, Any]) -> Query:
    order = args.get("p_order_by", "date")
    direction = args.get("p_direction", "desc")
    if order not in ("date", "amount") or direction not in ("asc", "desc"):
        raise ValueError("This adapter only handles validated page orders")
    amount = order == "amount"
    nulls = "first" if not amount and direction == "desc" else "last"
    tie = direction if not amount else "asc"
    limit = args.get("p_limit", 25)
    offset = args.get("p_offset", 0)
    materialization = "materialized" if amount else "not materialized"
    cap = "limit 10001" if amount else ""
    marketplace_candidates = _uses_marketplace_candidates(definition, args)
    common = [("date", args.get("p_date_from")), ("date", args.get("p_date_to"))]
    if function == "transaction_page":
        replacements = (
            direction,
            "source_amount" if amount else "activity_date",
            ""
            if amount
            else (
                f"order by activity_date {direction} nulls {nulls}, "
                f"source {tie}, source_row_id {tie}"
            ),
            materialization,
            cap,
            nulls,
            tie,
            *_marketplace_page_parts(marketplace_candidates, direction, nulls, tie),
        )
        values = [
            *common,
            ("uuid[]", args.get("p_company_ids")),
            ("text[]", args.get("p_skus")),
            ("text[]", args.get("p_marketplaces")),
            ("text[]", args.get("p_sources")),
            ("text[]", args.get("p_types")),
            ("bigint", 10001 if amount else offset + limit),
            ("integer", limit),
            ("bigint", offset),
            ("boolean", args.get("p_include_count", True)),
            ("boolean", args.get("p_fee_applicable")),
            ("text[]", args.get("p_search_skus")),
            ("text[]", args.get("p_search_types")),
            ("text[]", args.get("p_search_marketplaces")),
            ("text[]", args.get("p_search_sources")),
            ("boolean", amount),
        ]
    else:
        dataset = args.get("p_dataset")
        if dataset not in ("settlement", "data_kiosk"):
            raise ValueError("Raw dataset must be settlement or data_kiosk")
        settlement = dataset == "settlement"
        date = "posted_date" if settlement else "activity_date"
        projection = (
            "p.family, p.accounting_subtype, p.posted_date, p.posted_at, "
            "p.transaction_type, p.amount_type, p.amount_description"
            if settlement
            else "p.activity_date, p.component_key, p.fee_base::text, p.source_document_id"
        )
        candidate_projection = (
            "t.family, t.accounting_subtype, t.posted_date, t.posted_at, "
            "t.transaction_type, t.amount_type, t.amount_description"
            if settlement
            else "t.activity_date, t.component_key, t.fee_base, t.source_document_id"
        )
        replacements = (
            dataset + "_transactions",
            "true" if settlement else "t.amount <> 0",
            date,
            "amount" if amount else date,
            direction,
            "settlement_id" if settlement else "day_id",
            projection,
            dataset + "_preprocess_versions",
            "r.amount::numeric" if amount else "r." + date,
            materialization,
            _source_candidate_query(marketplace_candidates, amount, date, direction, nulls, tie),
            candidate_projection,
            nulls,
            tie,
        )
        values = [
            *common,
            ("text[]", args.get("p_skus")),
            ("text[]", args.get("p_marketplaces")),
            ("text[]", args.get("p_types")),
            ("integer", limit),
            ("bigint", offset),
            ("boolean", args.get("p_include_count", True)),
            ("text[]", args.get("p_search_skus")),
            ("text[]", args.get("p_search_types")),
            ("text[]", args.get("p_search_marketplaces")),
            ("boolean", amount),
        ]
    return _bind_positions(_format_body(definition, replacements), values)


def _read_query(
    connection: Connection, definition: str, function: str, args: dict[str, Any]
) -> Query:
    bodies = re.findall(r"\breturn \(\s*(.*?)\n\s*\);", definition, re.S)
    if function == "sku_filter_options":
        # Explain only actors admitted by the installed RPC itself. Extracting its
        # SELECT without this call would skip the administrator-only PL/pgSQL gate.
        admitted = connection.execute("select public.sku_filter_options() is not null").fetchone()
        if admitted != (True,) or len(bodies) != 1:
            raise ValueError("Install the current administrator-only SKU catalog RPC")
        return bodies[0], []
    if not bodies:
        raise ValueError("Installed return SELECT was not found")
    values = {
        "p_date_from": ("date", args.get("p_date_from")),
        "p_date_to": ("date", args.get("p_date_to")),
        "p_company_ids": ("uuid[]", args.get("p_company_ids")),
        "p_skus": ("text[]", args.get("p_skus")),
        "p_marketplaces": ("text[]", args.get("p_marketplaces")),
        "p_sources": ("text[]", args.get("p_sources")),
        "p_types": ("text[]", args.get("p_types")),
        "p_fee_applicable": ("boolean", args.get("p_fee_applicable")),
        "p_currency": ("text", args.get("p_currency")),
        "p_group_by_type": ("boolean", args.get("p_group_by_type", False)),
        "p_limit": ("integer", args.get("p_limit", 1000)),
        "p_offset": ("bigint", args.get("p_offset", 0)),
        "p_dataset": ("text", args.get("p_dataset")),
        "p_search_skus": ("text[]", args.get("p_search_skus")),
        "p_search_types": ("text[]", args.get("p_search_types")),
        "p_search_marketplaces": ("text[]", args.get("p_search_marketplaces")),
        "p_search_sources": ("text[]", args.get("p_search_sources")),
    }
    if function != "source_transaction_count":
        policy = connection.execute(
            "select private.member_policy_covers_current_version("
            "'private.settlement_transactions'::regclass),"
            "private.member_policy_covers_current_version('private.data_kiosk_transactions'::regclass)"
        ).fetchone()
        if policy is None:
            raise RuntimeError("Policy lookup returned no row")
        values["settlement_policy_is_sufficient"] = ("boolean", policy[0])
        values["kiosk_policy_is_sufficient"] = ("boolean", policy[1])
        body = bodies[0]
    else:
        dataset = args.get("p_dataset")
        if dataset not in ("settlement", "data_kiosk") or len(bodies) != 2:
            raise ValueError("Unrecognized raw count branch")
        body = bodies[0 if dataset == "settlement" else 1]
    return _bind_names(body, values)


def explain_rpc(
    connection: Connection, user_id: str, function: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    if function not in _ALLOWED:
        raise ValueError("Only maintained read RPCs are supported")
    if connection.info.transaction_status != TransactionStatus.IDLE:
        raise ValueError("Use an idle connection so role/read-only settings remain local")
    with connection.transaction():
        connection.execute("set transaction read only")
        connection.execute("set local statement_timeout='30s'")
        rows = connection.execute(
            "select pg_get_functiondef(oid) from pg_proc "
            "where pronamespace='public'::regnamespace and proname=%s",
            (function,),
        ).fetchall()
        if len(rows) != 1:
            raise ValueError("Expected one installed RPC definition")
        definition = rows[0][0]
        connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user_id,))
        connection.execute("set local role authenticated")
        connection.execute("set local search_path=''")
        if function.endswith("_page"):
            query, parameters = _page_query(definition, function, arguments)
        else:
            query, parameters = _read_query(connection, definition, function, arguments)
        # No persistent prepare and correctly typed values reproduce a custom
        # plan without changing the connection's plan_cache_mode or scan options.
        # Query text is extracted only from the allowlisted installed definitions.
        result = connection.execute(
            cast(LiteralString, "explain (analyze,format json,timing off,summary off) " + query),
            parameters,
            prepare=False,
        ).fetchone()
        if result is None:
            raise RuntimeError("EXPLAIN returned no row")
        plan = result[0][0]["Plan"]
    active = [node for node in _walk(plan) if node.get("Actual Loops", 0) > 0]
    return {
        "rpc": function,
        "installed_definition_sha256": hashlib.sha256(definition.encode()).hexdigest(),
        "indexes": sorted({node["Index Name"] for node in active if "Index Name" in node}),
        "index_nodes": [
            {
                key: node[key]
                for key in (
                    "Node Type",
                    "Relation Name",
                    "Index Name",
                    "Scan Direction",
                    "Actual Rows",
                    "Actual Loops",
                )
                if key in node
            }
            for node in active
            if "Index Name" in node
        ],
        "relation_scans": [
            {
                key: node[key]
                for key in ("Node Type", "Relation Name", "Actual Rows", "Actual Loops")
                if key in node
            }
            for node in active
            if "Relation Name" in node and "Index Name" not in node
        ],
        "sorts": [
            {key: node[key] for key in ("Node Type", "Actual Rows", "Actual Loops") if key in node}
            for node in _walk(plan)
            if node.get("Node Type") in ("Sort", "Incremental Sort")
        ],
    }
