"""Observed, authorized filter scopes for the optional-index experiment."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from psycopg import sql

from .common import Connection
from .ordering_cases import DATASETS, Dataset

Record = dict[str, Any]


@dataclass(frozen=True)
class IndexCase:
    role: str
    name: str
    endpoint: str
    arguments: Record
    count_endpoint: str | None = None
    count_arguments: Record | None = None


def _page(role: str, dataset: Dataset, name: str, **filters: object) -> IndexCase:
    direction = filters.pop("p_direction", "desc")
    limit = filters.pop("p_limit", 25)
    offset = filters.pop("p_offset", 0)
    common = {**({"p_dataset": dataset.key} if dataset.key != "live" else {}), **filters}
    return IndexCase(
        role,
        dataset.key + "/" + name,
        dataset.endpoint,
        {
            **common,
            "p_order_by": "date",
            "p_direction": direction,
            "p_limit": limit,
            "p_offset": offset,
            "p_include_count": False,
        },
        "transaction_count" if dataset.key == "live" else "source_transaction_count",
        common,
    )


def _groups(connection: Connection, dataset: Dataset, field: str) -> list[tuple[Any, ...]]:
    visible = (
        sql.SQL("(source <> 'DATA_KIOSK' or source_amount <> 0)")
        if dataset.key == "live"
        else sql.SQL("amount <> 0")
        if dataset.key == "data_kiosk"
        else sql.SQL("true")
    )
    return connection.execute(
        sql.SQL(
            "select {}::text,count(*),min({}),max({}) from {} where {} and {} is not null "
            "group by {} order by count(*) desc,{}::text"
        ).format(
            sql.Identifier(field),
            sql.Identifier(dataset.date_column),
            sql.Identifier(dataset.date_column),
            sql.Identifier("public", dataset.relation),
            visible,
            sql.Identifier(field),
            sql.Identifier(field),
            sql.Identifier(field),
        )
    ).fetchall()


def _recent(day: date) -> Record:
    return {"p_date_from": (day - timedelta(days=9)).isoformat(), "p_date_to": day.isoformat()}


def discover(connection: Connection, subjects: dict[str, str]) -> tuple[list[IndexCase], Record]:
    """Keep actual filter values in memory; save only their selectivity metadata."""
    cases: list[IndexCase] = []
    metadata: Record = {}
    for role, user in subjects.items():
        metadata[role] = {}
        with connection.transaction():
            connection.execute("set local role authenticated")
            connection.execute(
                "select set_config('request.jwt.claims',%s,true)",
                (json.dumps({"sub": user, "role": "authenticated"}),),
            )
            for dataset in DATASETS:
                skus = _groups(connection, dataset, "sku")
                markets = _groups(connection, dataset, "marketplace_name")
                types = _groups(connection, dataset, "component_type")
                if not skus or not markets or not types:
                    raise RuntimeError(
                        "Index workload requires visible SKU/marketplace/type scopes"
                    )
                common = skus[0]
                sparse = next((row for row in reversed(skus) if row[1] >= 25), skus[-1])
                sparse_market = next(
                    (row for row in reversed(markets) if row[1] >= 25), markets[-1]
                )
                sparse_type = next((row for row in reversed(types) if row[1] >= 25), types[-1])
                selected = list(dict.fromkeys((common[0], sparse[0])))
                latest = max(row[3] for row in skus)
                metadata[role][dataset.key] = {
                    "distinct_skus": len(skus),
                    "common_sku_rows": common[1],
                    "sparse_sku_rows": sparse[1],
                    "distinct_marketplaces": len(markets),
                    "common_marketplace_rows": markets[0][1],
                    "sparse_marketplace_rows": sparse_market[1],
                    "distinct_types": len(types),
                    "sparse_type_rows": sparse_type[1],
                }
                cases.extend(
                    [
                        _page(role, dataset, "newest"),
                        _page(role, dataset, "oldest", p_direction="asc"),
                    ]
                )
                if dataset.key != "live":
                    cases.extend(
                        [
                            _page(role, dataset, "single_sparse_sku", p_skus=[sparse[0]]),
                            _page(
                                role,
                                dataset,
                                "marketplace_date",
                                p_marketplaces=[markets[0][0]],
                                **_recent(markets[0][3]),
                            ),
                        ]
                    )
                    continue
                cases.extend(
                    [
                        _page(role, dataset, "single_sparse_sku", p_skus=[sparse[0]]),
                        _page(
                            role,
                            dataset,
                            "single_sparse_marketplace",
                            p_marketplaces=[sparse_market[0]],
                        ),
                        _page(
                            role,
                            dataset,
                            "sku_date_literal",
                            p_skus=[common[0]],
                            p_search=common[0],
                            **_recent(common[3]),
                        ),
                        _page(role, dataset, "multiple_skus", p_skus=selected),
                        _page(
                            role,
                            dataset,
                            "multiple_marketplaces",
                            p_marketplaces=list(dict.fromkeys((markets[0][0], markets[-1][0]))),
                        ),
                        _page(
                            role,
                            dataset,
                            "sparse_type_date",
                            p_types=[sparse_type[0]],
                            **_recent(sparse_type[3]),
                        ),
                        _page(
                            role,
                            dataset,
                            "date_no_match",
                            p_search="zz_absent_index_probe_704231",
                            **_recent(latest),
                        ),
                    ]
                )
                last = max(row[3] for row in (common, sparse))
                next_day = last + timedelta(days=1)
                end = last if next_day.day == 1 else last.replace(day=1) - timedelta(days=1)
                for label, start, finish in (
                    ("latest_day", last, last),
                    ("latest_month", end.replace(day=1), end),
                ):
                    cases.append(
                        IndexCase(
                            role,
                            "totals/" + label + "_selected_skus",
                            "transaction_totals",
                            {
                                "p_skus": selected,
                                "p_date_from": start.isoformat(),
                                "p_date_to": finish.isoformat(),
                                "p_limit": 1000,
                                "p_offset": 0,
                            },
                        )
                    )
    cases.append(IndexCase("member_a", "authorization/current_versions", "sql_versions", {}))
    scope = connection.execute(
        "select seller_namespace,source_identity_id::text,preprocess_version,"
        "min(activity_date),max(activity_date) from public.live_company_components "
        "where source='SETTLEMENT' group by seller_namespace,source_identity_id,preprocess_version "
        "having bool_and(company_id is not null) order by count(*) desc limit 1"
    ).fetchone()
    if scope is None:
        raise RuntimeError("No fully owned Settlement scope for the maintained backend read")
    cases.append(
        IndexCase(
            "backend",
            "backend/company_financial_progress",
            "sql_progress",
            {"scope": [scope[0], scope[3], scope[4], scope[2], [scope[1]], [], "economics"]},
        )
    )
    return cases, metadata


def final_guardrails(connection: Connection, subjects: dict[str, str]) -> list[IndexCase]:
    """Broader final checks kept outside the family pilot matrix."""
    cases: list[IndexCase] = []
    live = DATASETS[0]
    for role, user in subjects.items():
        with connection.transaction():
            connection.execute("set local role authenticated")
            connection.execute(
                "select set_config('request.jwt.claims',%s,true)",
                (json.dumps({"sub": user, "role": "authenticated"}),),
            )
            common = _groups(connection, live, "sku")[0]
            types = _groups(connection, live, "component_type")
            sparse_type = next((row for row in reversed(types) if row[1] >= 25), types[-1])
            row = connection.execute(
                "select max(activity_date) from public.live_company_components "
                "where source <> 'DATA_KIOSK' or source_amount <> 0"
            ).fetchone()
            if row is None or row[0] is None:
                raise RuntimeError("Guardrail identity has no visible date")
            latest = row[0]
        end = (
            latest
            if (latest + timedelta(days=1)).day == 1
            else latest.replace(day=1) - timedelta(days=1)
        )
        for name, start, finish in (
            ("latest_day_all", latest, latest),
            ("latest_month_all", end.replace(day=1), end),
        ):
            cases.append(
                IndexCase(
                    role,
                    "totals/" + name,
                    "transaction_totals",
                    {
                        "p_date_from": start.isoformat(),
                        "p_date_to": finish.isoformat(),
                        "p_limit": 1000,
                        "p_offset": 0,
                    },
                )
            )
        cases.extend(
            [
                _page(role, live, "latest_date_limit_one", p_limit=1),
                _page(role, live, "sparse_type_all_dates", p_types=[sparse_type[0]]),
                _page(role, live, "common_sku_oldest", p_skus=[common[0]], p_direction="asc"),
                _page(
                    role,
                    live,
                    "common_sku_deep_offset",
                    p_skus=[common[0]],
                    p_offset=min(10000, max(0, common[1] - 25)),
                ),
            ]
        )
    company = connection.execute(
        "select company_id::text from public.app_accounts where user_id=%s::uuid",
        (subjects["member_a"],),
    ).fetchone()
    if company is None or company[0] is None:
        raise RuntimeError("Guardrail member lacks a company")
    cases.append(_page("operator", live, "company_filtered_newest", p_company_ids=[company[0]]))
    return cases


def sql_result(connection: Connection, case: IndexCase, subjects: dict[str, str]) -> list[Any]:
    with connection.transaction():
        connection.execute("set transaction read only")
        if case.endpoint == "sql_versions":
            connection.execute("set local role authenticated")
            connection.execute(
                "select set_config('request.jwt.claims',%s,true)",
                (json.dumps({"sub": subjects[case.role], "role": "authenticated"}),),
            )
            rows = connection.execute(
                "select source,id::text from ("
                "select 'SETTLEMENT' source,"
                "private.current_company_source_versions('SETTLEMENT') id "
                "union all select 'DATA_KIOSK',"
                "private.current_company_source_versions('DATA_KIOSK')"
                ") q order by source,id"
            ).fetchall()
            return [list(row) for row in rows]
        rows = connection.execute(
            "select row_to_json(q)::text from (select * from private.company_financial_progress("
            "%s,%s::date,%s::date,%s,%s::uuid[],%s::public.amazon_marketplace_name[],%s) "
            "order by company_id,currency) q",
            case.arguments["scope"],
        ).fetchall()
        return [json.loads(value, parse_float=str, parse_int=str) for (value,) in rows]
