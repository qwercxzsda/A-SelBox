"""Opt-in, disposable real-seed checks for financial authority and tenant payouts."""

from __future__ import annotations

import argparse
import calendar
import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Any

import psycopg

from services.db.supabase.tests.isolated_database import isolated_database
from services.db.supabase.tests.real_seed_authority import verify_authority
from services.db.supabase.tests.real_seed_reconciliation import (
    month_coverage,
    verify_frozen_reconciliation,
    verify_live_reconciliation,
)
from services.db.supabase.tests.real_seed_reprocess import reprocess_local_archives
from services.db.supabase.tests.real_seed_supplement import publish_supplement
from services.db.supabase.tests.real_seed_support import (
    Connection,
    as_user,
    load_real_source_seed,
    require,
    source_fingerprints,
    source_versions,
)


def expect_denied(connection: Connection, user: str, company: str, month: date, code: str) -> None:
    try:
        as_user(
            connection,
            user,
            "select * from public.generate_company_payout_reports(%s,%s)",
            (company, month),
        )
    except psycopg.Error as error:
        require(error.sqlstate == code, "Generation rejection returned an unexpected SQLSTATE")
    else:
        raise AssertionError("An unauthorized or invalid payout generation succeeded")


def independent_payout_totals(connection: Connection, report_id: str) -> tuple[Any, ...]:
    """Recalculate Settlement category amounts and Data Kiosk costs from pinned inputs."""
    return connection.execute(
        """
        with inputs as (
            select p.report_id,t.seller_namespace,t.sku,t.marketplace_name,t.posted_date as day,
                t.currency,t.amount,case when t.transaction_type in ('Order','Refund')
                    and t.amount_type='ItemPrice' and t.amount_description='Principal'
                    then t.amount end as fee_base
            from private.payout_report_settlement_versions p
            join private.settlement_transactions t on t.version_id=p.version_id
            where p.report_id=%s and t.category='SETTLEMENT'
            union all
            select p.report_id,t.seller_namespace,t.sku,t.marketplace_name,t.activity_date,
                t.currency,t.amount,t.fee_base
            from private.payout_report_data_kiosk_versions p
            join private.data_kiosk_transactions t on t.version_id=p.version_id
            where p.report_id=%s and t.category='DATA_KIOSK'
        ), assigned as (
            select t.amount,case when t.fee_base is null then 0
                else -t.fee_base*p.fee_rate_percent/100 end as fee
            from public.company_payout_reports r
            join inputs t on t.report_id=r.id
            join public.seller_skus s on s.seller_namespace=t.seller_namespace and s.sku=t.sku
            join private.payout_report_terms_versions pin on pin.report_id=r.id
                and pin.seller_sku_id=s.id
            join public.sku_terms_versions v on v.id=pin.terms_version_id
                and v.company_id=r.company_id
            left join public.sku_fee_periods p on p.terms_version_id=v.id
                and p.marketplace_name=t.marketplace_name and p.valid_period @> t.day
            where r.id=%s and t.currency=r.currency
                and t.day between r.start_date and r.end_date
        ) select coalesce(sum(amount),0),coalesce(sum(fee),0),coalesce(sum(amount+fee),0)
        from assigned
        """,
        (report_id, report_id, report_id),
    ).fetchall()[0]


def verify_report_components(
    connection: Connection, reports: list[tuple[Any, ...]], month: date
) -> int:
    """Check saved totals, independent arithmetic, and elaboration boundaries."""
    elaboration_count = 0
    for report in reports:
        report_id, _, start, end, source_amount, fee_amount, company_amount = report
        require(
            start == month
            and end == month.replace(day=calendar.monthrange(month.year, month.month)[1]),
            "Report is not one complete month",
        )
        summary = connection.execute(
            """
            select coalesce(sum(source_amount) filter (where authoritative),0),
                coalesce(sum(fee_amount) filter (where authoritative),0),
                coalesce(sum(company_amount) filter (where authoritative),0),
                count(*) filter (where not authoritative),
                count(*) filter (where authoritative and not (
                    (source='SETTLEMENT' and exists (
                        select 1 from private.settlement_transactions s
                        where s.id=c.source_row_id and s.category='SETTLEMENT'))
                    or (source='DATA_KIOSK' and exists (
                        select 1 from private.data_kiosk_transactions k
                        where k.id=c.source_row_id and k.category='DATA_KIOSK')))),
                count(*) filter (where not authoritative and
                    (source <> 'DATA_KIOSK' or fee_amount is not null
                        or company_amount is not null))
            from public.company_payout_report_components c where report_id=%s
            """,
            (report_id,),
        ).fetchall()[0]
        require(
            tuple(summary[:3]) == (source_amount, fee_amount, company_amount),
            "A payout header includes elaboration money or differs from its components",
        )
        require(
            independent_payout_totals(connection, report_id)
            == (source_amount, fee_amount, company_amount),
            "A payout header differs from an independent raw-source and fee calculation",
        )
        require(summary[4] == 0 and summary[5] == 0, "Frozen component authority is inconsistent")
        elaboration_count += summary[3]
    return elaboration_count


def verify_member_access(
    connection: Connection,
    members: list[tuple[Any, ...]],
    reports: list[tuple[Any, ...]],
    month: date,
) -> None:
    """Exercise both tenant boundaries and the generation permission boundary."""
    for user, company in members:
        visible = as_user(connection, user, "select id::text from public.company_payout_reports")
        expected = {(row[0],) for row in reports if row[1] == company}
        require(set(visible) == expected, "A member can read another company's payout header")
        visible_components = as_user(
            connection,
            user,
            "select distinct report_id::text from public.company_payout_report_components",
        )
        expected_components = connection.execute(
            "select distinct c.report_id::text from public.company_payout_report_components c "
            "join public.company_payout_reports r on r.id=c.report_id where r.company_id=%s",
            (company,),
        ).fetchall()
        require(
            set(visible_components) == set(expected_components),
            "A member's payout components leak or are absent",
        )
        require(
            as_user(connection, user, "select * from public.payout_report_terms_versions") == [],
            "A member can read privileged payout exclusion evidence",
        )
        require(
            as_user(connection, user, "select * from public.payout_report_reconciliation") == [],
            "A member can read another company's daily seller reconciliation context",
        )
        expect_denied(connection, user, company, month, "42501")
        other_company = next(value for _, value in members if value != company)
        expect_denied(connection, user, other_company, month, "42501")


def verify_payouts(
    connection: Connection, operator: str, month: date, mature_cutoff_date: date
) -> dict[str, object]:
    """Generate real monthly snapshots, then test each stored member's visibility."""
    members = connection.execute(
        "select user_id::text,company_id::text from public.app_accounts "
        "where access_role='company_member' order by company_id"
    ).fetchall()
    require(len(members) >= 2, "Seed must provide members of at least two companies")
    report_ids: list[str] = []
    for _, company in members:
        reports = as_user(
            connection,
            operator,
            "select * from public.generate_company_payout_reports(%s,%s)",
            (company, month),
        )
        require(bool(reports), "A seeded company's mature month produced no report")
        report_ids.extend(str(row[0]) for row in reports)
    connection.execute("set constraints all immediate")
    reports = connection.execute(
        "select id::text,company_id::text,start_date,end_date,source_amount,fee_amount,"
        "company_amount from public.company_payout_reports"
    ).fetchall()
    require(len(reports) == len(report_ids), "Generation returned an incomplete report inventory")
    require(
        len(as_user(connection, operator, "select id from public.company_payout_reports"))
        == len(reports),
        "Administrator cannot see every generated company's reports",
    )
    elaboration_count = verify_report_components(connection, reports, month)
    require(elaboration_count > 0, "Real monthly reports did not preserve Data Kiosk elaboration")
    reconciliation_count = verify_frozen_reconciliation(
        connection, operator, reports, mature_cutoff_date
    )
    verify_member_access(connection, members, reports, month)
    # Server and UI enforce calendar shape and the mature cutoff date.
    expect_denied(connection, operator, members[0][1], month.replace(day=2), "22023")
    expect_denied(connection, operator, members[0][1], date(2099, 1, 1), "22023")
    return {
        "month": month.isoformat(),
        "companies_verified": len(members),
        "reports_generated": len(reports),
        "elaboration_components": elaboration_count,
        "frozen_reconciliation_rows": reconciliation_count,
        "frozen_reconciliation_exact_and_admin_only": True,
        "exact_component_sums_match": True,
        "independent_source_and_fee_sums_match": True,
        "member_company_isolation": True,
        "member_generation_rejected": True,
        "invalid_and_recent_months_rejected": True,
    }


def verify_seed(seed: Path, supplement_cache: Path) -> dict[str, object]:
    """Verify the complete, actual June workflow without changing retained source inputs."""
    with isolated_database() as target, psycopg.connect(target) as connection:
        evidence = load_real_source_seed(connection, seed)
        versions = source_versions(connection)
        fingerprints = source_fingerprints(connection, versions)
        operator = connection.execute(
            "select user_id::text from public.app_accounts where access_role='operator' limit 1"
        ).fetchall()[0][0]
        mature_cutoff_date, evidence["authority"] = verify_authority(connection, operator)
        evidence["reconciliation"] = verify_live_reconciliation(connection, mature_cutoff_date)
        evidence["original_june_coverage"] = month_coverage(connection, date(2026, 6, 1))
        company = connection.execute(
            "select company_id::text from public.app_accounts "
            "where access_role='company_member' limit 1"
        ).fetchall()[0][0]
        expect_denied(connection, operator, company, date(2026, 6, 1), "23514")
        require(
            connection.execute("select count(*) from public.company_payout_reports").fetchall()[0][
                0
            ]
            == 0,
            "Incomplete June coverage left a partial report",
        )
        evidence["missing_cost_coverage_rejected_atomically"] = True
        evidence["authentic_archive_replay"] = reprocess_local_archives(connection)
        evidence["supplementary_acquisition"] = publish_supplement(connection, supplement_cache)
        coverage = month_coverage(connection, date(2026, 6, 1))
        require(coverage["missing_days"] == 0, "Supplement did not complete June cost coverage")
        evidence["supplemented_june_coverage"] = coverage
        _, evidence["supplemented_authority"] = verify_authority(connection, operator)
        evidence["supplemented_reconciliation"] = verify_live_reconciliation(
            connection, mature_cutoff_date
        )
        evidence["eligible_june_payouts"] = verify_payouts(
            connection, operator, date(2026, 6, 1), mature_cutoff_date
        )
        require(
            source_fingerprints(connection, versions) == fingerprints,
            "Verification modified original source rows or their classifications",
        )
        evidence["original_source_rows_and_categories_unchanged"] = True
        evidence["original_database_modified"] = False
        evidence["auth_credentials_imported"] = False
    with seed.open("rb") as source:
        require(
            hashlib.file_digest(source, "sha256").hexdigest() == evidence["seed_sha256"],
            "Original seed checksum changed during verification",
        )
    evidence["original_seed_unchanged"] = True
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", required=True, type=Path)
    parser.add_argument("--supplement-cache", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    evidence = verify_seed(args.seed, args.supplement_cache)
    output = json.dumps(evidence, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
