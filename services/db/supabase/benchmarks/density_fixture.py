"""Increase facts per existing source version only in the dedicated local clone."""

# SQL identifiers come from catalog metadata for two fixed tables, not caller input.
# ruff: noqa: S608
from __future__ import annotations

import json
import time

from .common import psql

DATABASE = "aselbox_opt_large"


def _copy_statement(table: str, versions: str, factor: int) -> str:
    columns = psql(
        DATABASE,
        "select string_agg(quote_ident(attname), ',' order by attnum) "
        f"from pg_attribute where attrelid='private.{table}'::regclass "
        "and attnum>0 and not attisdropped;",
    ).split(",")
    expressions: list[str] = []
    for column in columns:
        if column == "id":
            expression = "private.uuid7()"
        elif column == "source_line_number":
            expression = "t.source_line_number + copies.n * t.max_line"
        elif column == "component_key":
            expression = "t.component_key || ':benchmark-copy:' || copies.n"
        else:
            expression = "t." + column
        expressions.append(expression)
    return f"""
with seed as materialized (
    select t.*, max(source_line_number) over (partition by version_id) as max_line
    from private.{table} t
)
insert into private.{table} ({",".join(columns)})
select {",".join(expressions)}
from seed t cross join generate_series(1,{factor - 1}) copies(n);
update private.{versions} v set row_count = actual.n
from (select version_id,count(*)::integer n from private.{table} group by version_id) actual
where v.id=actual.version_id;
"""


def build_density(factor: int = 10) -> dict[str, object]:
    if type(factor) is not int or not 2 <= factor <= 20:
        raise ValueError("Density factor must be between 2 and 20")
    original = psql(
        DATABASE,
        "select (select count(*) from private.settlement_transactions),"
        "(select count(*) from private.data_kiosk_transactions);",
    )
    settlement_count, kiosk_count = (int(value) for value in original.split("|"))
    if not settlement_count or not kiosk_count:
        raise ValueError("Density setup requires source facts in both datasets")
    if (
        psql(
            DATABASE,
            "select exists(select 1 from private.data_kiosk_transactions "
            "where strpos(component_key,':benchmark-copy:')>0)",
        )
        != "f"
    ):
        raise ValueError("Refusing repeated density expansion")
    started = time.perf_counter()
    statements = [
        "begin; set local statement_timeout='5min'; set local session_replication_role=replica;"
    ]
    for table, versions in (
        ("settlement_transactions", "settlement_preprocess_versions"),
        ("data_kiosk_transactions", "data_kiosk_preprocess_versions"),
    ):
        statements.append(_copy_statement(table, versions, factor))
    statements.append("set local session_replication_role=origin; commit; analyze;")
    psql(DATABASE, "\n".join(statements), role="supabase_admin")
    counts = json.loads(
        psql(
            DATABASE,
            "select json_build_object('settlement_facts',"
            "(select count(*) from private.settlement_transactions), 'data_kiosk_facts',"
            "(select count(*) from private.data_kiosk_transactions), 'fact_relations_with_rls',"
            "(select count(*) from pg_class where oid in "
            "('private.settlement_transactions'::regclass,"
            "'private.data_kiosk_transactions'::regclass) and relrowsecurity));",
        )
    )
    if (
        counts["settlement_facts"] != settlement_count * factor
        or counts["data_kiosk_facts"] != kiosk_count * factor
    ):
        raise RuntimeError("Density fixture row counts are inconsistent")
    return {
        "database": DATABASE,
        "factor": factor,
        "seed_settlement_facts": settlement_count,
        "seed_data_kiosk_facts": kiosk_count,
        **counts,
        "setup_seconds": round(time.perf_counter() - started, 3),
        "method": "Copy each fact with new identity/key; update clone-only source inventories.",
        "limitation": "Date, SKU, company and source-version cardinalities stay seed-sized.",
        "read_security": (
            "Roles, grants and RLS unchanged; setup trigger suppression ends before reads."
        ),
    }
