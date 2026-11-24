"""Execute an installed read RPC under its caller and capture non-sensitive plan metrics."""

import hashlib
from typing import Any, cast

from psycopg import sql
from psycopg.pq import TransactionStatus

from .common import Connection

_READ_RPCS = {
    "transaction_page",
    "source_transaction_page",
    "transaction_count",
    "source_transaction_count",
    "transaction_totals",
    "sku_filter_options",
}


def explain_rpc(
    connection: Connection, user_id: str, function: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    if function not in _READ_RPCS:
        raise ValueError("Only maintained read RPCs are supported")
    if connection.info.transaction_status != TransactionStatus.IDLE:
        raise ValueError("Plan collection requires an idle connection")
    with connection.transaction():
        connection.execute("set transaction read only")
        connection.execute("set local statement_timeout='30s'")
        row = connection.execute(
            "select pg_get_functiondef(oid) from pg_proc "
            "where pronamespace='public'::regnamespace and proname=%s",
            (function,),
        ).fetchone()
        if row is None:
            raise LookupError("Missing public RPC")
        digest = hashlib.sha256(row[0].encode()).hexdigest()
        connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user_id,))
        connection.execute("set local role authenticated")
        query = sql.SQL(
            "explain (analyze,buffers,format json,timing off) select public.{}({})"
        ).format(
            sql.Identifier(function),
            sql.SQL(",").join(sql.SQL("{} => %s").format(sql.Identifier(key)) for key in arguments),
        )
        result = connection.execute(query, tuple(arguments.values()), prepare=False).fetchone()
        if result is None:
            raise RuntimeError("EXPLAIN returned no result")
        measured = cast(dict[str, Any], result[0][0])
    plan = measured["Plan"]
    return {
        "rpc": function,
        "installed_definition_sha256": digest,
        "execution_ms": measured["Execution Time"],
        "planning_ms": measured["Planning Time"],
        "node_type": plan["Node Type"],
        "buffers": {key: value for key, value in plan.items() if key.endswith(" Blocks")},
    }
