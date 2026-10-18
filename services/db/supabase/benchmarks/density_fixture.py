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
        "select (select count(*) from private.finances_transaction_components),"
        "(select count(*) from private.data_kiosk_transactions);",
    )
    finances_count, kiosk_count = (int(value) for value in original.split("|"))
    if not finances_count or not kiosk_count:
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
    statements.append(_copy_finances(factor))
    statements.append(
        _copy_statement("data_kiosk_transactions", "data_kiosk_preprocess_versions", factor)
    )
    statements.append("set local session_replication_role=origin; commit; analyze;")
    psql(DATABASE, "\n".join(statements), role="supabase_admin")
    counts = json.loads(
        psql(
            DATABASE,
            "select json_build_object('finances_facts',"
            "(select count(*) from private.finances_transaction_components), 'data_kiosk_facts',"
            "(select count(*) from private.data_kiosk_transactions), 'fact_relations_with_rls',"
            "(select count(*) from pg_class where oid in "
            "('private.finances_transaction_components'::regclass,"
            "'private.data_kiosk_transactions'::regclass) and relrowsecurity));",
        )
    )
    if (
        counts["finances_facts"] != finances_count * factor
        or counts["data_kiosk_facts"] != kiosk_count * factor
    ):
        raise RuntimeError("Density fixture row counts are inconsistent")
    return {
        "database": DATABASE,
        "factor": factor,
        "seed_finances_facts": finances_count,
        "seed_data_kiosk_facts": kiosk_count,
        **counts,
        "setup_seconds": round(time.perf_counter() - started, 3),
        "method": "Copy each fact with new identity/key; update clone-only source inventories.",
        "limitation": "Date, SKU, company and source-version cardinalities stay seed-sized.",
        "read_security": (
            "Roles, grants and RLS unchanged; setup trigger suppression ends before reads."
        ),
    }


def _copy_finances(factor: int) -> str:
    """Expand native parents and their components together, preserving monetary partitions."""
    statements = [
        f"""
create temporary table benchmark_finances_ids on commit drop as
select t.id old_id,n copy,private.uuid7() new_id from private.finances_transactions t
cross join generate_series(1,{factor - 1}) copies(n);
"""
    ]
    for table in ("finances_transactions", "finances_transaction_components"):
        columns = psql(
            DATABASE,
            "select string_agg(quote_ident(attname),',' order by attnum) "
            f"from pg_attribute where attrelid='private.{table}'::regclass "
            "and attnum>0 and not attisdropped;",
        ).split(",")
        expressions: list[str] = []
        for column in columns:
            if column == "id":
                expression = "m.new_id" if table == "finances_transactions" else "private.uuid7()"
            elif column == "transaction_id":
                expression = "m.new_id"
            elif column in {
                "native_transaction_id",
                "deferred_transaction_id",
                "release_transaction_id",
                "component_key",
            }:
                expression = "t." + column + " || ':benchmark-copy:' || m.copy"
            else:
                expression = "t." + column
            expressions.append(expression)
        key = "id" if table == "finances_transactions" else "transaction_id"
        statements.append(
            f"insert into private.{table} ({','.join(columns)}) "
            f"select {','.join(expressions)} from private.{table} t "
            f"join pg_temp.benchmark_finances_ids m on m.old_id=t.{key};"
        )
    statements.append(f"""
update private.finances_preprocess_versions v
set row_count = row_count * {factor}, transaction_count = transaction_count * {factor}
where not exists (select 1 from private.finances_pruned_versions p where p.version_id=v.id);
update private.finances_summary_checks
set summary_amount=summary_amount * {factor}, transaction_amount=transaction_amount * {factor};
""")
    return "\n".join(statements)
