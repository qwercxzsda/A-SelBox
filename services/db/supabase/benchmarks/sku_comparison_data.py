"""Identical private source evidence and synthetic ownership for a schema A/B run.

Legacy namespace terms exist only in this benchmark's before-schema adapter.
Real companies, accounts, terms, and payout snapshots are never imported.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from types import MappingProxyType
from typing import Any, TextIO, cast
from uuid import uuid7

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.real_seed_support import COPY_HEADER, SOURCE_TABLES

Connection = psycopg.Connection[tuple[Any, ...]]
_PRIVATE_SOURCES = tuple(sorted(table for table in SOURCE_TABLES if table.startswith("private.")))
_FACT_TABLES = ("private.settlement_transactions", "private.data_kiosk_transactions")


@dataclass(frozen=True)
class ComparisonData:
    """Private query inputs and aggregate fixture evidence for a controlled pair."""

    member_id: str = field(repr=False)
    operator_id: str = field(repr=False)
    company_id: str = field(repr=False)
    selected_sku: str = field(repr=False)
    date_from: date
    date_to: date
    source_rows: int
    source_table_rows: Mapping[str, int]
    skus: int
    namespaces: int
    member_skus: int
    old_terms_count: int
    new_terms_count: int
    old_fee_period_count: int
    new_fee_period_count: int
    seed_sha256: str

    def actor_id(self, actor: str) -> str:
        if actor == "member":
            return self.member_id
        if actor == "operator":
            return self.operator_id
        raise ValueError("Unknown comparison actor")

    def evidence(self) -> dict[str, object]:
        """Return only publishable counts, dates, and the unchanged seed digest."""
        return {
            "date_from": self.date_from.isoformat(),
            "date_to": self.date_to.isoformat(),
            "source_rows": self.source_rows,
            "source_table_rows": dict(self.source_table_rows),
            "skus": self.skus,
            "namespaces": self.namespaces,
            "member_skus": self.member_skus,
            "old_terms_count": self.old_terms_count,
            "new_terms_count": self.new_terms_count,
            "old_fee_period_count": self.old_fee_period_count,
            "new_fee_period_count": self.new_fee_period_count,
            "seed_sha256": self.seed_sha256,
        }


@dataclass(frozen=True, repr=False)
class _Accounts:
    company_a: str
    company_b: str
    member: str
    operator: str


@dataclass(frozen=True)
class SkuSources:
    sku: str
    namespaces: tuple[str, ...]
    marketplaces: tuple[str, ...]
    row_count: int
    namespace_marketplaces: dict[str, tuple[str, ...]]


def _fingerprint(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _validate_targets(before: Connection, after: Connection) -> None:
    identities: list[str] = []
    for connection in (before, after):
        name = str(require_row(connection.execute("select current_database()").fetchone())[0])
        if not name.startswith("aselbox_test_"):
            raise ValueError("SKU comparisons require disposable test databases")
        identities.append(name)
        for relation in (*_PRIVATE_SOURCES, "public.companies", "public.app_accounts"):
            statement = sql.SQL("select exists(select 1 from {})").format(
                sql.Identifier(*relation.split("."))
            )
            if require_row(connection.execute(statement).fetchone())[0]:
                raise ValueError("SKU comparisons require empty source and application tables")
    if identities[0] == identities[1]:
        raise ValueError("Before and after must use different disposable databases")


def _copy_lines(source: TextIO) -> Iterator[str]:
    for line in source:
        if line.rstrip("\r\n") == "\\.":
            return
        yield line
    raise ValueError("The seed contains an unterminated COPY block")


def _copy_sources(before: Connection, after: Connection, seed: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    try:
        with before.transaction(), after.transaction():
            for connection in (before, after):
                connection.execute("set local session_replication_role = replica")
            with seed.open(encoding="utf-8") as source:
                for line in source:
                    if not line.startswith("COPY "):
                        continue
                    match = COPY_HEADER.fullmatch(line)
                    if match is None:
                        raise ValueError("The seed contains an unsupported COPY header")
                    schema, table, columns = match.groups()
                    relation = schema + "." + table
                    if relation not in _PRIVATE_SOURCES:
                        for _ in _copy_lines(source):
                            pass
                        continue
                    statement = sql.SQL("copy {} ({}) from stdin").format(
                        sql.Identifier(schema, table),
                        sql.SQL(", ").join(
                            sql.Identifier(value.strip()) for value in columns.split(",")
                        ),
                    )
                    count = 0
                    with (
                        before.cursor().copy(statement) as before_copy,
                        after.cursor().copy(statement) as after_copy,
                    ):
                        for row in _copy_lines(source):
                            before_copy.write(row)
                            after_copy.write(row)
                            count += 1
                    counts[relation] = counts.get(relation, 0) + count
            for connection in (before, after):
                connection.execute("set local session_replication_role = origin")
                connection.execute("set constraints all immediate")
                connection.execute("set constraints all deferred")
        before.commit()
        after.commit()
    except psycopg.Error as error:
        # COPY diagnostics may contain actual source cells; never surface them.
        raise ValueError(f"Private source import failed (SQLSTATE {error.sqlstate})") from None
    if not all(counts.get(table, 0) for table in _FACT_TABLES):
        raise ValueError("The comparison seed must contain both source fact tables")
    return counts


def _text_array(value: object) -> tuple[str, ...]:
    """Reject unregistered domain arrays instead of treating text as characters."""
    if not isinstance(value, (list, tuple)):
        raise ValueError("Source inventory arrays must be decoded PostgreSQL text arrays")
    values = cast(list[object] | tuple[object, ...], value)
    if any(not isinstance(item, str) for item in values):
        raise ValueError("Source inventory arrays must contain only text values")
    result = cast(tuple[str, ...], tuple(values))
    if len(result) != len(set(result)):
        raise ValueError("Source inventory arrays must contain distinct text values")
    return result


def _source_skus(connection: Connection) -> list[SkuSources]:
    rows = connection.execute(
        "with source as ("
        "select sku,seller_namespace,marketplace_name from private.settlement_transactions "
        "union all "
        "select sku,seller_namespace,marketplace_name from private.data_kiosk_transactions) "
        "select sku,seller_namespace::text,"
        "coalesce(array_agg(distinct marketplace_name::text order by marketplace_name::text) "
        "filter(where marketplace_name is not null),'{}'),count(*) "
        "from source where sku is not null group by sku,seller_namespace "
        'order by sku collate "C",seller_namespace::text collate "C"'
    ).fetchall()
    by_sku: dict[str, dict[str, tuple[str, ...]]] = {}
    row_counts: dict[str, int] = {}
    for sku_value, namespace_value, markets, count in rows:
        sku, namespace = str(sku_value), str(namespace_value)
        namespaces = by_sku.setdefault(sku, {})
        if namespace in namespaces:
            raise ValueError("Source inventory must contain each namespace/SKU pair once")
        namespaces[namespace] = _text_array(markets)
        row_counts[sku] = row_counts.get(sku, 0) + int(count)
    return [
        SkuSources(
            sku,
            tuple(namespaces),
            tuple(sorted({market for markets in namespaces.values() for market in markets})),
            row_counts[sku],
            namespaces,
        )
        for sku, namespaces in by_sku.items()
    ]


def _create_accounts(connection: Connection, accounts: _Accounts) -> None:
    connection.execute(
        "insert into public.companies(id,name) values (%s,'Benchmark company A'),"
        "(%s,'Benchmark company B')",
        (accounts.company_a, accounts.company_b),
    )
    connection.execute(
        "insert into auth.users(id) values (%s),(%s)", (accounts.member, accounts.operator)
    )
    connection.execute(
        "insert into public.app_accounts(user_id,access_role,company_id) values "
        "(%s,'company_member',%s),(%s,'operator',null)",
        (accounts.member, accounts.company_a, accounts.operator),
    )
    connection.execute(
        "create or replace function private.mature_cutoff_date() "
        "returns date language sql stable parallel safe security invoker "
        "set search_path='' as $$ select date '2026-07-28' $$"
    )


def _terms_payload(
    source: SkuSources, company: str, marketplaces: tuple[str, ...] | None = None
) -> dict[str, object]:
    markets = source.marketplaces if marketplaces is None else marketplaces
    return {
        "id": str(uuid7()),
        "sku_id": str(uuid7()),
        "sku": source.sku,
        "company_id": company,
        "expected_current_version_id": None,
        "change_reason": "Controlled benchmark synthetic ownership and fees",
        "periods": [
            {
                "id": str(uuid7()),
                "marketplace_name": marketplace,
                "valid_from": "1900-01-01",
                "valid_to": None,
                "fee_rate_percent": "5",
            }
            for marketplace in markets
        ],
    }


def _publish_before_terms(connection: Connection, source: SkuSources, company: str) -> int:
    """Adapt only the isolated baseline schema's legacy publication contract."""
    for namespace in source.namespaces:
        payload = _terms_payload(source, company, source.namespace_marketplaces[namespace])
        payload["seller_sku_id"] = payload.pop("sku_id")
        payload["seller_namespace"] = namespace
        connection.execute("select private.publish_sku_terms(%s::jsonb)", (Jsonb(payload),))
    return len(source.namespaces)


def _vacuum_sources(connection: Connection) -> None:
    connection.commit()
    prior_autocommit = connection.autocommit
    connection.autocommit = True
    try:
        for relation in _PRIVATE_SOURCES:
            connection.execute(
                sql.SQL("vacuum (analyze) {}").format(sql.Identifier(*relation.split(".")))
            )
        connection.execute("analyze")
    finally:
        connection.autocommit = prior_autocommit


def _select_ownership(skus: list[SkuSources]) -> tuple[str, set[str]]:
    shared = [source for source in skus if len(source.namespaces) > 1]
    if not shared:
        raise ValueError("The comparison seed must contain an exact SKU across namespaces")
    selected = min(shared, key=lambda source: (-source.row_count, source.sku.encode()))
    owned_skus = {source.sku for source in skus[::2]}
    if selected.sku not in owned_skus:
        owned_skus.remove(max(owned_skus, key=lambda value: value.encode()))
        owned_skus.add(selected.sku)
    return selected.sku, owned_skus


def _publish_ownership(
    before: Connection, after: Connection, skus: list[SkuSources], owned_skus: set[str]
) -> tuple[_Accounts, int]:
    accounts = _Accounts(*(str(uuid7()) for _ in range(4)))
    expected_before_terms = len(
        {(source.sku, namespace) for source in skus for namespace in source.namespaces}
    )
    before_terms = 0
    with before.transaction(), after.transaction():
        for connection in (before, after):
            _create_accounts(connection, accounts)
        for source in skus:
            company = accounts.company_a if source.sku in owned_skus else accounts.company_b
            before_terms += _publish_before_terms(before, source, company)
            after.execute(
                "select private.publish_sku_terms(%s::jsonb)",
                (Jsonb(_terms_payload(source, company)),),
            )
    if before_terms != expected_before_terms:
        raise ValueError("Baseline terms must publish each namespace/SKU pair exactly once")
    before.commit()
    after.commit()
    return accounts, before_terms


def _activity_window(connection: Connection) -> tuple[date, date]:
    latest = require_row(
        connection.execute(
            "select max(activity_date) from public.live_company_components where authoritative"
        ).fetchone()
    )[0]
    if latest is None:
        raise ValueError("The comparison seed has no authoritative live activity")
    date_to = cast(date, latest)
    return date_to - timedelta(days=59), date_to


def populate_pair(
    before_connection: Connection, after_connection: Connection, seed_path: Path
) -> ComparisonData:
    """Populate a fresh pair; keep returned source identifiers private to the caller."""
    _validate_targets(before_connection, after_connection)
    fingerprint = _fingerprint(seed_path)
    source_counts = _copy_sources(before_connection, after_connection, seed_path)
    skus = _source_skus(after_connection)
    selected_sku, owned_skus = _select_ownership(skus)
    accounts, before_terms = _publish_ownership(
        before_connection, after_connection, skus, owned_skus
    )
    date_from, date_to = _activity_window(after_connection)
    for connection in (before_connection, after_connection):
        _vacuum_sources(connection)
    if _fingerprint(seed_path) != fingerprint:
        raise ValueError("The comparison seed changed while preparing the databases")
    return ComparisonData(
        member_id=accounts.member,
        operator_id=accounts.operator,
        company_id=accounts.company_a,
        selected_sku=selected_sku,
        date_from=date_from,
        date_to=date_to,
        source_rows=sum(source_counts[table] for table in _FACT_TABLES),
        source_table_rows=MappingProxyType(source_counts),
        skus=len(skus),
        namespaces=len({namespace for source in skus for namespace in source.namespaces}),
        member_skus=len(owned_skus),
        old_terms_count=before_terms,
        new_terms_count=len(skus),
        old_fee_period_count=sum(
            len(markets) for source in skus for markets in source.namespace_marketplaces.values()
        ),
        new_fee_period_count=sum(len(source.marketplaces) for source in skus),
        seed_sha256=fingerprint,
    )
