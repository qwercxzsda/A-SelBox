"""Independent view/RLS oracle and current bounded table RPC response contracts."""

from __future__ import annotations

import json
from dataclasses import replace
from decimal import Decimal
from typing import TypedDict, cast

from psycopg import sql

from .common import Connection
from .ordering_cases import DATASETS, canonical_rows
from .search_cases import SEARCH_COLUMNS, SearchCase
from .transport import request

AMOUNT_LIMIT = 10_000
AMOUNT_ERROR = (
    "Amount ordering is limited to 10,000 matching transactions. "
    "Narrow your filters or order by date."
)
Row = dict[str, str | None]


class Payload(TypedDict):
    rows: list[Row]
    total_count: str | None


def view_filter(case: SearchCase) -> tuple[sql.Composed, list[object]]:
    clauses: list[sql.Composable] = [sql.SQL("true")]
    params: list[object] = []
    if case.dataset.key == "live":
        clauses.append(sql.SQL("(v.source <> 'DATA_KIOSK' or v.source_amount <> 0)"))
    elif case.dataset.key == "data_kiosk":
        clauses.append(sql.SQL("v.amount <> 0"))
    for value, comparison in ((case.date_from, sql.SQL(">=")), (case.date_to, sql.SQL("<="))):
        if value is not None:
            clauses.append(
                sql.SQL("v.{} {} %s::date").format(
                    sql.Identifier(case.dataset.date_column), comparison
                )
            )
            params.append(value)
    for field, values, data_type in (
        ("sku", case.skus, sql.SQL("text[]")),
        ("component_type", case.types, sql.SQL("text[]")),
        (
            "marketplace_name",
            (case.marketplace,) if case.marketplace is not None else (),
            sql.SQL("public.amazon_marketplace_name[]"),
        ),
    ):
        if values:
            clauses.append(sql.SQL("v.{} = any(%s::{})").format(sql.Identifier(field), data_type))
            params.append(list(values))
    if case.search.strip():
        matches: list[sql.Composable] = []
        pattern = "***=" + case.search.strip()
        for field in SEARCH_COLUMNS[case.dataset.key]:
            matches.append(sql.SQL("v.{}::text ~* %s").format(sql.Identifier(field)))
            params.append(pattern)
            if field == "source":
                matches.append(
                    sql.SQL(
                        "(case v.source when 'SETTLEMENT' then 'Settlements' "
                        "when 'DATA_KIOSK' then 'Data Kiosk' end) ~* %s"
                    )
                )
                params.append(pattern)
        clauses.append(sql.SQL("({})").format(sql.SQL(" or ").join(matches)))
    return sql.SQL(" and ").join(clauses), params


def read_reference(connection: Connection, user: str, case: SearchCase) -> Payload | None:
    """Use the existing view under the same actor; never sort an over-cap reference."""
    predicate, params = view_filter(case)
    relation = sql.Identifier("public", case.dataset.relation)
    with connection.transaction():
        connection.execute("set local role authenticated")
        connection.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (json.dumps({"sub": user, "role": "authenticated"}),),
        )
        if case.expect_cap:
            row = connection.execute(
                sql.SQL(
                    "select count(*) from (select 1 from {} v where {} limit 10001) guard"
                ).format(relation, predicate),
                params,
            ).fetchone()
            if row is None or row[0] != AMOUNT_LIMIT + 1:
                raise RuntimeError("Broad amount fixture did not exceed the sorting limit")
            return None
        count = connection.execute(
            sql.SQL("select count(*)::text from {} v where {}").format(relation, predicate), params
        ).fetchone()
        if count is None:
            raise RuntimeError("View did not return a count")
        if case.order_by == "amount" and int(count[0]) > AMOUNT_LIMIT:
            raise RuntimeError("Filtered amount fixture exceeded the sorting limit")
        column = case.dataset.date_column if case.order_by == "date" else case.dataset.amount_column
        nulls = sql.SQL("nulls first") if case.descending_date else sql.SQL("nulls last")
        tie_direction = sql.SQL("desc") if case.descending_date else sql.SQL("asc")
        ordering = sql.SQL(", ").join(
            [
                sql.SQL("v.{} {} {}").format(
                    sql.Identifier(column),
                    sql.SQL("asc") if case.direction == "asc" else sql.SQL("desc"),
                    nulls,
                ),
                *(
                    sql.SQL("v.{} {}").format(sql.Identifier(name), tie_direction)
                    for name in case.dataset.tie_columns
                ),
            ]
        )
        rows = connection.execute(
            sql.SQL(
                "select row_to_json(r)::text from (select {} from {} v where {} "
                "order by {} limit 25 offset %s) r"
            ).format(
                sql.SQL(", ").join(sql.Identifier("v", field) for field in case.dataset.columns),
                relation,
                predicate,
                ordering,
            ),
            [*params, case.offset],
        ).fetchall()
    decoded: list[Row] = []
    for (value,) in rows:
        raw = json.loads(value, parse_float=Decimal, parse_int=str)
        decoded.append(
            {
                field: str(entry) if isinstance(entry, Decimal) else entry
                for field, entry in raw.items()
            }
        )
    return {"rows": canonical_rows(decoded), "total_count": str(count[0])}


def read_rpc_page(
    base: str, token: str, case: SearchCase, *, include_count: bool = False
) -> tuple[Payload, int]:
    value, size = request(
        base, case.dataset.endpoint, case.arguments(include_count=include_count), token
    )
    if not isinstance(value, dict):
        raise RuntimeError("Page returned an invalid envelope")
    payload = cast(dict[str, object], value)
    if set(payload) != {"rows", "total_count"} or not isinstance(payload["rows"], list):
        raise RuntimeError("Page returned an invalid envelope")
    rows = cast(list[object], payload["rows"])
    if len(rows) > 25:
        raise RuntimeError("Page exceeded its row limit")
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError("Page returned an invalid row")
        fields = cast(dict[str, object], row)
        if set(fields) != set(case.dataset.columns) or any(
            entry is not None and not isinstance(entry, str) for entry in fields.values()
        ):
            raise RuntimeError("Page did not preserve its exact text/NULL projection")
    total = payload["total_count"]
    if include_count and (not isinstance(total, str) or not total.isdecimal()):
        raise RuntimeError("Page returned an invalid count")
    if not include_count and total is not None:
        raise RuntimeError("Page returned an unexpected count")
    return {
        "rows": canonical_rows(cast(list[Row], rows)),
        "total_count": cast(str | None, total),
    }, size


def discover_cases(connection: Connection, user: str) -> list[SearchCase]:
    cases: list[SearchCase] = []
    with connection.transaction():
        connection.execute("set local role authenticated")
        connection.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (json.dumps({"sub": user, "role": "authenticated"}),),
        )
        for dataset in DATASETS:
            blank = SearchCase(dataset, "date_blank", "date", "desc")
            predicate, params = view_filter(blank)
            scope = connection.execute(
                sql.SQL(
                    "select v.sku,v.marketplace_name::text,v.component_type,v.{},v.currency "
                    "from {} v where {} and v.sku is not null and v.marketplace_name is not null "
                    "group by v.sku,v.marketplace_name,v.component_type,v.{},v.currency "
                    "having count(*) between 1 and 10000 order by count(*) desc,v.sku,v.{} limit 1"
                ).format(
                    sql.Identifier(dataset.date_column),
                    sql.Identifier("public", dataset.relation),
                    predicate,
                    sql.Identifier(dataset.date_column),
                    sql.Identifier(dataset.date_column),
                ),
                params,
            ).fetchone()
            if scope is None:
                raise RuntimeError("Fixture has no positive below-cap filtered amount group")
            sku, marketplace, kind, day, currency = scope
            cases.extend(
                [
                    blank,
                    replace(
                        blank,
                        name="amount_over_limit",
                        order_by="amount",
                        expect_cap=True,
                    ),
                    SearchCase(
                        dataset,
                        "amount_filtered",
                        "amount",
                        "desc",
                        search=str(currency),
                        skus=(str(sku),),
                        marketplace=str(marketplace),
                        types=(str(kind),),
                        date_from=day.isoformat(),
                        date_to=day.isoformat(),
                    ),
                    SearchCase(
                        dataset,
                        "date_no_match",
                        "date",
                        "desc",
                        search="zz_no_such_literal_match_583104",
                        date_from=day.isoformat(),
                        date_to=day.isoformat(),
                    ),
                ]
            )
    return cases
