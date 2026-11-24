"""Benchmark signed-in workspace reads on a populated local PostgreSQL database."""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import LiteralString

import psycopg

from services.sync.src.database.config import LOCAL_SUPABASE_URL

from .common import Connection, bind_authenticated_actor, connect
from .runner import Record, cli, run


@dataclass(frozen=True)
class Read:
    name: str
    query: LiteralString
    # A missing discovery result skips only the cases that depend on it.
    params: tuple[object, ...] | None = ()
    missing: str = "skipped_no_visible_report"


def _workspace_reads(connection: Connection, role: str) -> list[Read]:
    report = connection.execute(
        "select id,start_date,company_id from public.latest_company_payout_reports "
        "where record_count>0 order by record_count desc,id limit 1"
    ).fetchone()
    report_id = (report[0],) if report else None
    sku = connection.execute(
        "select id,terms_version_id from public.company_skus order by sku,id limit 1"
    ).fetchone()
    reads = [
        Read("workspace_revisions", "select public.workspace_revisions()"),
        Read("companies", "select id,name from public.companies order by name,id limit 1000"),
        Read("company_skus", "select * from public.company_skus order by sku,id limit 1000"),
        Read("fee_configuration", "select public.sku_configuration()"),
        Read(
            "fee_history_versions",
            "select * from public.assignment_versions where kind='SKU' and key_id=%s "
            "order by version_number desc,id limit 51",
            (sku[0],) if sku else None,
            "skipped_no_visible_sku",
        ),
        Read(
            "fee_history_periods",
            "select * from public.sku_fee_periods where assignment_version_id=%s "
            "order by marketplace_name,valid_period,id limit 1000",
            (sku[1],) if sku else None,
            "skipped_no_visible_sku",
        ),
        Read(
            "inventory_captures",
            "select * from public.latest_inventory_captures "
            "order by marketplace_name,capture_id limit 1000",
        ),
        Read(
            "inventory_items",
            "select * from public.latest_inventory_items order by capture_id,sku limit 1000",
        ),
        Read(
            "payout_list",
            "select * from public.latest_company_payout_reports "
            "order by start_date desc,id limit 25",
        ),
        Read(
            "payout_readiness",
            "select * from public.payout_readiness(%s)",
            (report[1],)
            if report
            else connection.execute(
                "select (public.payout_report_policy()->>'latest_month')::date"
            ).fetchone(),
        ),
        Read("payout_records", "select public.payout_report_records(%s,50,0)", report_id),
        Read("payout_type_totals", "select public.payout_report_totals(%s,true,1000,0)", report_id),
        Read(
            "payout_grand_total", "select public.payout_report_totals(%s,false,1000,0)", report_id
        ),
    ]
    if role == "administrator":
        reads.extend(_review_reads(connection))
        reads.extend(
            [
                Read(
                    "account_directory", "select * from public.account_directory() order by user_id"
                ),
                Read(
                    "assignments",
                    "select * from public.assignment_status "
                    "order by kind,seller_namespace,amazon_scope,native_key limit 51",
                ),
                Read(
                    "assignment_warnings",
                    "select * from public.assignment_status where warning is not null "
                    "order by kind,seller_namespace,amazon_scope,native_key limit 51",
                ),
                Read(
                    "payout_setup_blockers",
                    "select * from public.payout_setup_blockers(%s,%s)",
                    (report[2], report[1]) if report else None,
                ),
            ]
        )
    return reads


def _review_reads(connection: Connection) -> list[Read]:
    # Find an actual marketplace/month for each outcome to avoid timing empty pages.
    scopes = {
        outcome: (month, market)
        for outcome, month, market in connection.execute(
            "select distinct on(outcome) outcome, "
            "date_trunc('month',posted_date)::date,marketplace_name "
            "from public.financial_outcomes order by outcome,posted_date desc,marketplace_name"
        )
    }
    reads = [
        Read("review_months", "select * from public.financial_review_month_page()"),
        Read(
            "review_months_filtered",
            "select * from public.financial_review_month_page(%s,%s)",
            next(iter(scopes.values()), None),
            "skipped_no_visible_outcome",
        ),
    ]
    for outcome in ("COMPANY", "DIFFERENCE", "SELBOX"):
        scope = scopes.get(outcome)
        reads.extend(
            [
                Read(
                    f"review_{outcome.lower()}",
                    "select * from public.financial_outcome_page(%s)",
                    (outcome,),
                ),
                Read(
                    f"review_{outcome.lower()}_filtered",
                    "select * from public.financial_outcome_page(%s,%s,%s)",
                    (outcome, *scope) if scope else None,
                    "skipped_no_visible_outcome",
                ),
            ]
        )
    return reads


def measure_workspace(connection: Connection, repeat: int) -> Record:
    """Time complete SQL fetches as each available application role."""
    with connection.transaction():
        connection.execute("set transaction read only")
        actors = dict(
            connection.execute(
                "select distinct on(a.access_role) a.access_role::text,a.user_id::text "
                "from public.app_accounts a where a.access_role in ('administrator','member') "
                "order by a.access_role,exists(select 1 "
                "from public.latest_company_payout_reports r "
                "where r.company_id=a.company_id and r.record_count>0) desc,a.user_id"
            ).fetchall()
        )
    samples: list[Record] = []
    for role in ("administrator", "member"):
        user = actors.get(role)
        if user is None:
            samples.append({"role": role, "status": "skipped_no_account"})
            continue
        with connection.transaction():
            connection.execute("set transaction isolation level repeatable read, read only")
            bind_authenticated_actor(connection, user)
            actor = connection.execute(
                "select current_user,auth.uid()::text,current_setting('transaction_read_only')"
            ).fetchone()
            if actor != ("authenticated", user, "on"):
                raise RuntimeError("Workspace timing requires the selected read-only actor")
            for read in _workspace_reads(connection, role):
                sample: Record = {"role": role, "case": read.name}
                samples.append(sample)
                if read.params is None:
                    sample["status"] = read.missing
                    continue
                elapsed: list[float] = []
                for iteration in range(repeat + 1):
                    start = time.perf_counter()
                    connection.execute(read.query, read.params).fetchall()
                    if iteration:
                        elapsed.append(round((time.perf_counter() - start) * 1000, 3))
                sample.update(status="ok", elapsed_ms=elapsed, median_ms=round(median(elapsed), 3))
    return {"samples": samples}


def measure(database: str, _image: str, password: str, _directory: Path, repeat: int) -> Record:
    with connect(database, password) as connection:
        return measure_workspace(connection, repeat)


def measure_local(repeat: int) -> Record:
    # The fixed development DSN provides the TCP host/port and database. Pin
    # hostaddr too so libpq cannot redirect the connection through PGHOSTADDR.
    with psycopg.connect(
        LOCAL_SUPABASE_URL,
        hostaddr="127.0.0.1",
        options="-c default_transaction_read_only=on",
        autocommit=True,
        prepare_threshold=None,
    ) as connection:
        return measure_workspace(connection, repeat)


def main() -> None:
    run(
        __doc__,
        "Role-bound PostgreSQL timings for workspace views and RPCs.",
        measure,
        local_read=measure_local,
    )


if __name__ == "__main__":
    cli(main)
