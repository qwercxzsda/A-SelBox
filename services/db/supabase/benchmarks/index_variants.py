"""Allowlisted optional indexes; every change is confined to the history clone."""

from __future__ import annotations

from typing import Any, LiteralString, cast

from psycopg import sql

from .common import Connection, catalog_fingerprint

Record = dict[str, Any]
TABLES = {
    "settlement": ("settlement_transactions", "posted_date"),
    "kiosk": ("data_kiosk_transactions", "activity_date"),
}
BASE_NAMES = tuple(
    table + suffix
    for table, _ in TABLES.values()
    for suffix in (
        "_date_id_idx",
        "_owner_date_idx",
        "_marketplace_date_idx",
        "_sku_date_idx",
        "_sku_date_id_idx",
        "_type_date_idx",
        "_type_date_id_idx",
        "_marketplace_date_id_idx",
        "_seller_date_idx",
    )
)
FAMILIES = {
    "sku_date": ("sku",),
    "sku_date_id": ("sku",),
    "owner_date_id": ("seller_namespace", "sku"),
    "market_date": ("marketplace_name",),
    "market_date_id": ("marketplace_name",),
    "type_date": ("component_type",),
    "type_date_id": ("component_type",),
}
CANDIDATE_NAMES = tuple(f"bench_{source}_{family}_idx" for source in TABLES for family in FAMILIES)
PILOTS = ("baseline", "broad_date", "minimal", *FAMILIES)


def _guard(connection: Connection) -> None:
    if connection.info.dbname != "aselbox_opt_broad":
        raise RuntimeError("Optional index changes require the owned history clone")


def capture(connection: Connection) -> tuple[dict[str, str], dict[str, str]]:
    _guard(connection)
    rows = connection.execute(
        "select indexname,indexdef from pg_indexes where schemaname='private' "
        "and indexname=any(%s) order by indexname",
        (list(BASE_NAMES),),
    ).fetchall()
    definitions = dict(rows)
    required = {table + "_date_id_idx" for table, _ in TABLES.values()}
    if not required.issubset(definitions):
        raise RuntimeError("Install the current reversible date indexes before benchmarking")
    existing = connection.execute(
        "select indexname from pg_indexes where schemaname='private' and indexname=any(%s)",
        (list(CANDIDATE_NAMES),),
    ).fetchall()
    if existing:
        raise RuntimeError("Refusing to reuse unexpected candidate indexes")
    return definitions, catalog_fingerprint(connection)


def _clear(connection: Connection) -> None:
    for name in (*BASE_NAMES, *CANDIDATE_NAMES):
        connection.execute(sql.SQL("drop index if exists private.{}").format(sql.Identifier(name)))


def restore(connection: Connection, definitions: dict[str, str]) -> None:
    _guard(connection)
    _clear(connection)
    for definition in definitions.values():
        # These statements came from pg_get_indexdef for the exact allowlist above.
        connection.execute(cast(LiteralString, definition))


def _selected_families(value: object) -> dict[str, list[str]]:
    raw_sources: dict[str, object]
    if isinstance(value, list):
        raw_sources = dict.fromkeys(TABLES, cast(list[object], value))
    elif isinstance(value, dict):
        mapping = cast(dict[str, object], value)
        if not set(mapping).issubset(TABLES):
            raise ValueError("Unknown source in the finalist index set")
        raw_sources = {source: mapping.get(source, []) for source in TABLES}
    else:
        raise ValueError("Finalist families must be a list or per-source mapping")
    result: dict[str, list[str]] = {}
    for source, raw in raw_sources.items():
        if not isinstance(raw, list):
            raise ValueError("Each source must provide a list of index families")
        values = cast(list[object], raw)
        if not all(isinstance(family, str) and family in FAMILIES for family in values):
            raise ValueError("Finalists must combine only known index families")
        chosen = cast(list[str], values)
        if len(set(chosen)) != len(chosen):
            raise ValueError("Duplicate index family")
        result[source] = chosen
    return result


def apply(connection: Connection, variant: str | Record, definitions: dict[str, str]) -> str:
    _guard(connection)
    if isinstance(variant, str):
        if variant not in PILOTS:
            raise ValueError("Unknown index variant")
        name = variant
        families = {source: [variant] if variant in FAMILIES else [] for source in TABLES}
    else:
        name = variant["name"]
        if not isinstance(name, str) or not name.replace("_", "").isalnum():
            raise ValueError("Invalid finalist name")
        families = _selected_families(variant["families"])
    _clear(connection)
    if name in {"baseline", "broad_date"}:
        for index, definition in definitions.items():
            if name == "broad_date" and index == "settlement_transactions_date_id_idx":
                connection.execute(
                    "create index settlement_transactions_date_id_idx "
                    "on private.settlement_transactions (posted_date,id)"
                )
            else:
                connection.execute(cast(LiteralString, definition))
        return name
    for source, (table, day) in TABLES.items():
        connection.execute(
            sql.SQL("create index {} on private.{} ({},id)").format(
                sql.Identifier(table + "_date_id_idx"),
                sql.Identifier(table),
                sql.Identifier(day),
            )
        )
        for family in families[source]:
            columns = (*FAMILIES[family], day, *(("id",) if family.endswith("_id") else ()))
            connection.execute(
                sql.SQL("create index {} on private.{} ({})").format(
                    sql.Identifier(f"bench_{source}_{family}_idx"),
                    sql.Identifier(table),
                    sql.SQL(",").join(sql.Identifier(column) for column in columns),
                )
            )
    return name


def inventory(connection: Connection) -> list[Record]:
    return [
        {"table": table, "name": name, "bytes": size, "definition": definition}
        for table, name, size, definition in connection.execute(
            "select tablename,indexname,"
            "pg_relation_size(format('%%I.%%I',schemaname,indexname)::regclass),"
            "indexdef from pg_indexes where schemaname='private' and tablename=any(%s) "
            "order by tablename,indexname",
            ([table for table, _ in TABLES.values()],),
        ).fetchall()
    ]


def assert_rules_unchanged(connection: Connection, original: dict[str, str]) -> None:
    current = catalog_fingerprint(connection)
    if any(current[key] != value for key, value in original.items() if key != "indexes"):
        raise RuntimeError("Index experiment changed a protected schema/access definition")
