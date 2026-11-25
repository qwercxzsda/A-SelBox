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


# For each outcome in one marketplace-year: the month with most records, then its largest
# reason or group.
_BUSIEST_REVIEW_MONTHS: LiteralString = (
    "with months as (select * from public.financial_review_months(%s,%s) "
    "where measure in ('DIFFERENCE','SELBOX')), "
    "busiest as (select distinct on(measure) measure,month from months "
    "group by 1,2 order by measure,sum(amount_count) desc,month) "
    "select distinct on(measure) measure,month,reason,selbox_group "
    "from months join busiest using(measure,month) "
    "order by measure,amount_count desc,reason,selbox_group"
)


def _workspace_reads(connection: Connection, role: str) -> list[Read]:
    report = connection.execute(
        "select id,start_date,company_id from public.latest_company_payout_reports "
        "where record_count>0 order by record_count desc,id limit 1"
    ).fetchone()
    report_id = (report[0],) if report else None
    sku = connection.execute(
        "select id from public.company_skus order by sku,id limit 1"
    ).fetchone()
    reads = [
        Read("workspace_revisions", "select public.workspace_revisions()"),
        Read("payout_search_months", "select public.payout_search_months()"),
        Read("companies", "select id,name from public.companies order by name,id limit 1000"),
        Read("company_skus", "select * from public.company_skus order by sku,id limit 1000"),
        Read("fee_configuration", "select public.sku_configuration()"),
        Read(
            "fee_history",
            "select public.sku_configuration_history(%s)",
            (sku[0],) if sku else None,
            "skipped_no_visible_sku",
        ),
        Read("assignments", "select public.reference_assignments()"),
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
        reads.extend(_raw_data_reads(connection))
        assignment = connection.execute(
            "select id from public.assignment_keys where kind<>'SKU' order by id limit 1"
        ).fetchone()
        reads.extend(
            [
                Read(
                    "account_directory", "select * from public.account_directory() order by user_id"
                ),
                Read(
                    "assignment_history",
                    "select * from public.assignment_versions where key_id=%s "
                    "order by version_number desc",
                    (assignment[0],) if assignment else None,
                    "skipped_no_visible_assignment",
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
    """The busiest marketplace-year, then each outcome's busiest month and reason or group."""
    scope: tuple[object, ...] | None = connection.execute(
        "select marketplace_name,extract(year from posted_date)::int "
        "from public.financial_outcomes group by 1,2 order by count(*) desc,1,2 limit 1"
    ).fetchone()
    busiest: dict[str, tuple[object, ...]] = {}
    if scope is not None:
        for outcome, month, reason, group in connection.execute(_BUSIEST_REVIEW_MONTHS, scope):
            busiest[outcome] = (outcome, month, scope[0], reason, group)
    reads = [
        Read(
            "review_months",
            "select * from public.financial_review_months(%s,%s)",
            scope,
            "skipped_no_visible_outcome",
        )
    ]
    for outcome in ("DIFFERENCE", "SELBOX"):
        found = busiest.get(outcome)
        reads.extend(
            [
                Read(
                    f"review_{outcome.lower()}",
                    "select * from public.financial_outcome_page(%s,%s,%s)",
                    found[:3] if found else None,
                    "skipped_no_visible_outcome",
                ),
                Read(
                    f"review_{outcome.lower()}_filtered",
                    "select * from public.financial_outcome_page(%s,%s,%s,%s,%s)",
                    found,
                    "skipped_no_visible_outcome",
                ),
            ]
        )
    return reads


def _raw_data_reads(connection: Connection) -> list[Read]:
    """Each Raw data report's first page in its default order, and the largest invoice's lines."""
    invoice = connection.execute(
        "select version_id from public.current_ad_invoices order by line_count desc,id limit 1"
    ).fetchone()
    return [
        Read(
            "raw_ad_invoices",
            "select * from public.current_ad_invoices order by invoice_date desc,id limit 25",
        ),
        Read(
            "raw_ad_invoice_lines",
            "select * from public.current_ad_invoice_lines where version_id=%s "
            "order by line_number",
            (invoice[0],) if invoice else None,
            "skipped_no_visible_invoice",
        ),
        Read(
            "raw_storage",
            "select * from public.current_storage_rows order by month_of_charge desc,id limit 25",
        ),
        Read("raw_storage_count", "select count(*) from public.current_storage_rows"),
        Read(
            "raw_aged_storage",
            "select * from public.current_aged_storage_rows "
            "order by snapshot_month desc,id limit 25",
        ),
        Read(
            "raw_removal_orders",
            "select * from public.current_removal_order_rows "
            "order by request_date desc,id limit 25",
        ),
    ]


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
