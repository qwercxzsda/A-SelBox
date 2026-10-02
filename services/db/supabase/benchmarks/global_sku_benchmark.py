"""Measure exact-SKU reads in a fresh, bounded, synthetic local database."""

from __future__ import annotations

import argparse
import json
import statistics
import time
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, LiteralString, cast

from psycopg import sql

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture

from .plans import explain_rpc

_SKU = "SHARED-SKU"
_FILTERS: dict[str, object] = {
    "p_date_from": "2026-06-01",
    "p_date_to": "2026-06-30",
    "p_skus": [_SKU],
}
_READS: dict[str, LiteralString] = {
    "count_all_owned": "select public.transaction_count()",
    "count_selected_sku": (
        "select public.transaction_count(p_date_from=>'2026-06-01',"
        "p_date_to=>'2026-06-30',p_skus=>array['SHARED-SKU'])"
    ),
    "page_selected_sku": (
        "select public.transaction_page(p_date_from=>'2026-06-01',"
        "p_date_to=>'2026-06-30',p_skus=>array['SHARED-SKU'],"
        "p_limit=>25,p_include_count=>false)"
    ),
    "totals_selected_sku": (
        "select public.transaction_totals(p_date_from=>'2026-06-01',"
        "p_date_to=>'2026-06-30',p_skus=>array['SHARED-SKU'])"
    ),
}
_INDEX_COMPARISONS: tuple[tuple[str, str, tuple[str, ...], LiteralString | None], ...] = (
    (
        "settlement_owner",
        "settlement_transactions",
        ("sku", "version_id", "category", "marketplace_name"),
        "category = 'SETTLEMENT'",
    ),
    (
        "settlement_date_count",
        "settlement_transactions",
        ("posted_date", "component_type", "sku", "version_id", "category", "marketplace_name"),
        "category = 'SETTLEMENT'",
    ),
    (
        "kiosk_date_count",
        "data_kiosk_transactions",
        ("activity_date", "component_type", "sku", "version_id", "category", "marketplace_name"),
        None,
    ),
)


def _seed(
    fixture: SourceModelFixture, namespaces: int, matching: int, irrelevant: int
) -> tuple[str, set[str]]:
    """Use normal publication validation; do not disable triggers or RLS."""
    fixture.set_mature_cutoff_date(date(2026, 7, 1))
    company, identity = fixture.owner(_SKU)
    fixture.fee(identity, [("2026-01-01", None, "5")])
    member = fixture.member(company)
    expected_ids: set[str] = set()
    for namespace in range(namespaces):
        fixture.seller = f"synthetic-source-namespace-{namespace:02d}"
        skus = [_SKU] * matching + [f"UNOWNED-{index:05d}" for index in range(irrelevant)]
        settlement_rows = [
            fixture.transaction("10", index + 3, sku=sku) for index, sku in enumerate(skus)
        ]
        kiosk_rows = [fixture.component("-1", sku=sku) for sku in skus]
        expected_ids.update(str(row["id"]) for row in settlement_rows[:matching])
        expected_ids.update(str(row["id"]) for row in kiosk_rows[:matching])
        fixture.settlement(settlement_rows)
        fixture.kiosk(1, kiosk_rows)
    fixture.connection.commit()
    fixture.connection.autocommit = True
    fixture.connection.execute("vacuum (analyze) private.settlement_transactions")
    fixture.connection.execute("vacuum (analyze) private.data_kiosk_transactions")
    fixture.connection.execute("analyze")
    return member, expected_ids


def _verify(
    fixture: SourceModelFixture, member: str, expected_ids: set[str], matching: int
) -> dict[str, object]:
    """Use known synthetic arithmetic, rather than another version of the SQL."""
    page = cast(
        dict[str, Any],
        fixture.as_user(
            member,
            "select public.transaction_page(p_limit=>1000,p_skus=>array['SHARED-SKU'])",
        )[0][0],
    )
    rows = cast(list[dict[str, Any]], page["rows"])
    actual_ids = {str(row["source_row_id"]) for row in rows}
    if actual_ids != expected_ids or len(rows) != len(expected_ids):
        raise AssertionError("Member page lost, duplicated, or exposed unrelated source rows")
    if page["total_count"] != str(len(expected_ids)):
        raise AssertionError("Combined page count differs from the complete source inventory")
    for name in ("count_all_owned", "count_selected_sku"):
        if fixture.as_user(member, _READS[name])[0][0] != str(len(expected_ids)):
            raise AssertionError("Member exact count differs across source namespaces")
    totals = cast(dict[str, Any], fixture.as_user(member, _READS["totals_selected_sku"])[0][0])
    expected = {
        "reported_amount": Decimal(9 * matching),
        "service_fee": Decimal("-0.5") * matching,
        "company_amount": Decimal("8.5") * matching,
        "row_count": Decimal(2 * matching),
        "known_company_count": Decimal(2 * matching),
    }
    if len(totals["rows"]) != 1 or totals["next_offset"] is not None:
        raise AssertionError("Expected one complete synthetic currency total")
    if any(Decimal(totals["rows"][0][key]) != value for key, value in expected.items()):
        raise AssertionError("Cross-namespace totals do not match exact known arithmetic")
    if len({row["sku_id"] for row in rows}) != 1:
        raise AssertionError("Shared SKU resolved to more than one identity")
    return {"passed": True, "matching_rows": len(expected_ids), "sku_identities": 1}


def _measure(fixture: SourceModelFixture, member: str, repeat: int) -> list[dict[str, object]]:
    samples: dict[str, list[float]] = {name: [] for name in _READS}
    references: dict[str, object] = {}
    with fixture.connection.transaction():
        fixture.connection.execute("set transaction read only")
        fixture.connection.execute("set local statement_timeout='30s'")
        fixture.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (member,))
        fixture.connection.execute("set local role authenticated")
        for iteration in range(repeat + 1):
            names = list(_READS)
            rotation = iteration % len(names)
            for name in names[rotation:] + names[:rotation]:
                started = time.perf_counter()
                value = require_row(
                    fixture.connection.execute(_READS[name], prepare=False).fetchone()
                )[0]
                elapsed = (time.perf_counter() - started) * 1000
                if iteration == 0:
                    references[name] = value
                else:
                    if value != references[name]:
                        raise AssertionError("Repeated immutable fixture reads changed")
                    samples[name].append(round(elapsed, 3))
    return [
        {
            "case": name,
            "samples_ms": values,
            "median_ms": round(statistics.median(values), 3),
            "minimum_ms": min(values),
            "maximum_ms": max(values),
        }
        for name, values in samples.items()
    ]


def _index_sizes(fixture: SourceModelFixture) -> list[dict[str, object]]:
    """Compare fresh builds on identical data after measuring application plans."""
    comparisons: list[dict[str, object]] = []
    for name, table, columns, predicate in _INDEX_COMPARISONS:
        sizes: dict[str, int] = {}
        for namespace_key in (False, True):
            variant = "with_namespace" if namespace_key else "sku_only"
            keys = list(columns)
            if namespace_key:
                keys.insert(keys.index("sku"), "seller_namespace")
            index_name = "benchmark_" + name + "_" + variant
            fixture.connection.execute(
                sql.SQL("create index {} on private.{} ({}){}").format(
                    sql.Identifier(index_name),
                    sql.Identifier(table),
                    sql.SQL(", ").join(map(sql.Identifier, keys)),
                    sql.SQL("")
                    if predicate is None
                    else sql.SQL(" where {} ").format(sql.SQL(predicate)),
                )
            )
            sizes[variant] = int(
                require_row(
                    fixture.connection.execute(
                        "select pg_relation_size(%s::regclass)", ("private." + index_name,)
                    ).fetchone()
                )[0]
            )
        comparisons.append(
            {
                "index": name,
                "bytes": sizes,
                "reduction_percent": round(
                    100 * (1 - sizes["sku_only"] / sizes["with_namespace"]), 2
                ),
            }
        )
    return comparisons


def _verify_plans(
    fixture: SourceModelFixture, plans: list[dict[str, Any]]
) -> list[tuple[object, ...]]:
    """Check indexed fact access without forcing one cost-dependent index choice."""
    fact_indexes: set[str] = set()
    for plan in plans:
        for relation in ("settlement_transactions", "data_kiosk_transactions"):
            used = {
                node["Index Name"]
                for node in plan["index_nodes"]
                if node.get("Relation Name") == relation
            }
            if not used:
                raise AssertionError("Selected-SKU query did not use an index for " + relation)
            fact_indexes.update(used)
    keys = fixture.connection.execute(
        "select c.relname, pg_get_indexdef(i.indexrelid) from pg_index i "
        "join pg_class c on c.oid=i.indexrelid where c.relname=any(%s) order by c.relname",
        (sorted(fact_indexes),),
    ).fetchall()
    if any("seller_namespace" in str(definition) for _, definition in keys):
        raise AssertionError("Selected-SKU access still depends on namespace index keys")
    return keys


def run(namespaces: int, matching: int, irrelevant: int, repeat: int) -> dict[str, object]:
    fixture = SourceModelFixture()
    started = time.perf_counter()
    try:
        fixture.setUp()
        member, expected_ids = _seed(fixture, namespaces, matching, irrelevant)
        verification = _verify(fixture, member, expected_ids, namespaces * matching)
        measurements = _measure(fixture, member, repeat)
        plans = [
            explain_rpc(fixture.connection, member, function, arguments)
            for function, arguments in (
                ("transaction_count", _FILTERS),
                ("transaction_page", {**_FILTERS, "p_limit": 25, "p_include_count": False}),
                ("transaction_totals", _FILTERS),
            )
        ]
        index_keys = _verify_plans(fixture, plans)
        index_sizes = _index_sizes(fixture)
        version = require_row(fixture.connection.execute("show server_version").fetchone())[0]
    finally:
        if not fixture.doCleanups():
            raise RuntimeError("Disposable benchmark database cleanup failed")
    return {
        "recorded_at_utc": datetime.now(UTC).isoformat(),
        "postgres_version": version,
        "fixture": {
            "namespaces": namespaces,
            "matching_rows_per_source_namespace": matching,
            "irrelevant_rows_per_source_namespace": irrelevant,
            "total_source_rows": 2 * namespaces * (matching + irrelevant),
            "warmups_per_case": 1,
            "measured_repetitions": repeat,
        },
        "verification": verification,
        "measurements": measurements,
        "plans": plans,
        "used_fact_index_definitions": index_keys,
        "fresh_index_build_comparison": index_sizes,
        "disposable_database_removed": True,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "limits": (
            "Warm synthetic local direct-SQL RPC timings, including result decoding; "
            "no HTTP, browser, network latency, production data distribution, "
            "concurrency, historical source versions, or production scalability claim. "
            "Index size variants are fresh builds after timing, "
            "not an old-query latency comparison."
        ),
    }


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New JSON evidence file")
    parser.add_argument("--namespaces", type=int, default=3, help="Source namespaces (2-4)")
    parser.add_argument(
        "--matching", type=int, default=100, help="Matching rows per source (1-125)"
    )
    parser.add_argument(
        "--irrelevant", type=int, default=5000, help="Unowned rows per source (1000-10000)"
    )
    parser.add_argument("--repeat", type=int, default=5, help="Measured repetitions (1-10)")
    args = parser.parse_args(argv)
    for name, minimum, maximum in (
        ("namespaces", 2, 4),
        ("matching", 1, 125),
        ("irrelevant", 1000, 10000),
        ("repeat", 1, 10),
    ):
        if not minimum <= getattr(args, name) <= maximum:
            parser.error(f"{name} must be between {minimum} and {maximum}")
    if args.output.exists():
        parser.error("Output file already exists; choose a new path")
    result = run(args.namespaces, args.matching, args.irrelevant, args.repeat)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps({"output": str(args.output), "elapsed_seconds": result["elapsed_seconds"]}))


if __name__ == "__main__":
    main()
