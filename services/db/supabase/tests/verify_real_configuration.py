"""Opt-in full seed restore and configuration checks through real Auth and REST."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import psycopg

from services.db.supabase.benchmarks.common import docker
from services.db.supabase.tests.e2e.local_stack import LocalSupabaseStack
from services.db.supabase.tests.e2e.workflow_support import LocalWorkflowCase
from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.real_seed_authority import verify_authority
from services.db.supabase.tests.real_seed_reconciliation import verify_live_reconciliation
from services.db.supabase.tests.real_seed_support import (
    Connection,
    require,
    source_fingerprints,
    source_versions,
)
from services.sync.src.database.connection import PostgresDatabaseConnection


def _configuration(stack: LocalSupabaseStack, token: str) -> list[dict[str, Any]]:
    response = stack.request("POST", "/rest/v1/rpc/sku_configuration", token=token, json={})
    require(response.status_code == 200, "Real-seed configuration read failed")
    result = response.json()
    require(set(result) == {"items"}, "Configuration returned an unexpected envelope")
    return cast(list[dict[str, Any]], result["items"])


def _change(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "sku": item["sku"],
        "company_id": item["company_id"],
        "expected_current_version_id": item["terms_version_id"],
        "periods": copy.deepcopy(item["periods"]),
    }


def _state(connection: Connection) -> list[tuple[Any, ...]]:
    return connection.execute(
        "select 'sku',id::text,current_terms_version_id::text from public.skus "
        "union all select 'version',id::text,version_number::text from public.sku_terms_versions "
        "union all select 'fee',id::text,fee_rate_percent::text from public.sku_fee_periods "
        "union all select 'revision',source||':'||scope_company_id::text,revision::text "
        "from private.workspace_revision_tokens order by 1,2,3"
    ).fetchall()


def _publish(
    stack: LocalSupabaseStack, token: str, changes: list[dict[str, Any]], status: int
) -> dict[str, Any]:
    response = stack.request(
        "POST",
        "/rest/v1/rpc/publish_sku_configuration",
        token=token,
        json={"p_changes": changes, "p_change_reason": "Disposable real-seed verification"},
    )
    require(response.status_code == status, "Configuration publication returned unexpected status")
    return cast(dict[str, Any], response.json())


def _verify_writes(
    stack: LocalSupabaseStack,
    connection: Connection,
    operator: str,
    members: dict[str, str],
    items: list[dict[str, Any]],
) -> dict[str, object]:
    selected = next(item for item in items if item["requirements"] and item["periods"])
    other = next(item for item in items if item["sku"] != selected["sku"])
    change = _change(selected)
    destination = next(company for company in members if company != selected["company_id"])
    change["company_id"] = destination
    for period in change["periods"]:
        period["fee_rate_percent"] = "7.123456"
    incomplete = _change(other)
    incomplete["company_id"] = None
    before = _state(connection)
    error = _publish(stack, operator, [change, incomplete], 400)
    require(error.get("message") == "SKU configuration is incomplete", "Missing global rejection")
    require(_state(connection) == before, "Rejected batch changed immutable terms or revisions")
    _publish(stack, next(iter(members.values())), [change], 403)
    require(_state(connection) == before, "Member publication changed configuration")
    saved = _publish(stack, operator, [change], 200)
    require(saved["changed_count"] == 1, "Complete real-seed publication did not save once")
    current = _configuration(stack, operator)
    updated = next(item for item in current if item["sku"] == selected["sku"])
    require(updated["company_id"] == destination, "SKU reassignment did not publish")
    require(updated["periods"] == change["periods"], "Fee publication changed exact input values")
    require(not any(item["issues"] for item in current), "Complete save introduced setup gaps")
    for company, member in members.items():
        visible = {item["sku"] for item in _configuration(stack, member)}
        expected = {item["sku"] for item in current if item["company_id"] == company}
        require(visible == expected, "Member scope did not follow the reassignment")
    after = _state(connection)
    conflict = _publish(stack, operator, [change], 409)
    require(conflict.get("code") == "PT409", "Stale save did not reject the expected version")
    missing_fees = _change(updated)
    missing_fees["periods"] = []
    _publish(stack, operator, [missing_fees], 400)
    require(_state(connection) == after, "Rejected fee/stale save changed saved state")
    return {
        "atomic_global_rejection": True,
        "member_writes_denied": True,
        "assignment_and_exact_fee_update": True,
        "member_scope_follows_assignment": True,
        "stale_and_missing_fee_saves_rejected": True,
    }


def verify(seed: Path) -> dict[str, object]:
    with seed.open("rb") as source:
        fingerprint = hashlib.file_digest(source, "sha256").hexdigest()
    with LocalSupabaseStack() as stack:
        # The full private dump (including its Auth fixtures) is restored only
        # into this newly created local stack. Captured diagnostics never expose rows.
        with seed.open("rb") as source:
            docker(
                "exec",
                "-i",
                "supabase_db_" + stack.project_id,
                "psql",
                "-X",
                "-U",
                "postgres",
                "-d",
                "postgres",
                "--set",
                "ON_ERROR_STOP=1",
                stdin=source,
            )
        with (
            psycopg.connect(stack.database_url, autocommit=True) as connection,
            PostgresDatabaseConnection(stack.database_url) as database,
        ):
            fixture = LocalWorkflowCase()
            fixture.stack, fixture.database = stack, database
            operator_id, operator = fixture.create_operator()
            companies = [
                str(row[0]) for row in connection.execute("select id from public.companies")
            ]
            require(
                len(companies) >= 2, "Real configuration verification needs two fixture companies"
            )
            members = {company: fixture.create_member(company)[1] for company in companies}
            versions = source_versions(connection)
            fingerprints = source_fingerprints(connection, versions)
            items = _configuration(stack, operator)
            require(bool(items), "The real seed has no configured SKUs")
            require(
                not any(item["issues"] for item in items), "Real seed has incomplete configuration"
            )
            known = {
                row[0]
                for row in connection.execute(
                    "select sku from public.skus union "
                    "select sku from private.settlement_transactions "
                    "where sku is not null union select sku from private.data_kiosk_transactions "
                    "where sku is not null"
                )
            }
            require(
                {item["sku"] for item in items} == known, "Configuration missed known source SKUs"
            )
            require(
                all("seller_namespace" not in item for item in items),
                "Configuration leaked namespace",
            )
            member_counts: list[int] = []
            for company, token in members.items():
                visible = _configuration(stack, token)
                expected = [item for item in items if item["company_id"] == company]
                require(
                    visible == expected, "Member read differs from its exact saved configuration"
                )
                member_counts.append(len(visible))
            cutoff, authority = verify_authority(connection, operator_id)
            reconciliation = verify_live_reconciliation(connection, cutoff)
            settlement_count, kiosk_count = require_row(
                connection.execute(
                    "select (select count(*) from private.settlement_transactions),"
                    "(select count(*) from private.data_kiosk_transactions)"
                ).fetchone()
            )
            source_counts = {
                "settlement_transactions": int(settlement_count),
                "data_kiosk_transactions": int(kiosk_count),
            }
            publication = _verify_writes(stack, connection, operator, members, items)
            require(
                source_fingerprints(connection, versions) == fingerprints, "Source facts changed"
            )
    with seed.open("rb") as source:
        require(
            hashlib.file_digest(source, "sha256").hexdigest() == fingerprint, "Seed file changed"
        )
    return {
        "recorded_at_utc": datetime.now(UTC).isoformat(),
        "seed_sha256": fingerprint,
        "full_dump_restored": True,
        "source_rows": source_counts,
        "sku_count": len(items),
        "fee_period_count": sum(len(item["periods"]) for item in items),
        "member_sku_counts": sorted(member_counts),
        "setup_issues": 0,
        "independent_authority": authority,
        "independent_reconciliation": reconciliation,
        "publication_checks": publication,
        "source_facts_unchanged": True,
        "seed_file_unchanged_by_verification": True,
        "disposable_stack_removed": True,
        "scope": "Real source facts with synthetic seed assignments/fees; actual Auth and REST. "
        "Test publication affects the disposable database only. No SP-API calls or archive replay.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists() or args.output.is_symlink():
        parser.error("Choose a new output file; existing files, including the seed, are protected")
    result = verify(args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        output.write(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"verified": True, "output": str(args.output)}))


if __name__ == "__main__":
    try:
        main()
    except psycopg.Error as error:
        raise SystemExit(
            f"Real-seed database verification failed (SQLSTATE {error.sqlstate})"
        ) from None
