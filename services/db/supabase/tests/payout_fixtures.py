"""Shared inputs, generation requests, and immutable evidence for payout tests."""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import cast

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


def fill_payout_kiosk_month(
    fixture: SourceModelFixture, *, start_date: str = "2026-06-01", end_date: str = "2026-06-30"
) -> None:
    """Publish complete empty source days only where a payout fixture has no version."""
    start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
    existing = {
        row[0]
        for row in fixture.connection.execute(
            "select activity_date from private.data_kiosk_days where seller_namespace=%s "
            "and marketplace_name='Amazon.com' and dataset_key='economics' "
            "and current_version_id is not null and activity_date between %s and %s",
            (fixture.seller, start, end),
        ).fetchall()
    }
    current = start
    while current <= end:
        if current in existing:
            current += timedelta(days=1)
            continue
        missing_start = current
        days: list[dict[str, object]] = []
        while current <= end and current not in existing:
            days.append(
                {
                    "id": new_id(),
                    "marketplace_name": "Amazon.com",
                    "activity_date": current.isoformat(),
                    "expected_current_version_id": None,
                    "content_sha256": "c" * 64,
                    "transactions": [],
                }
            )
            current += timedelta(days=1)
        acquisition = fixture.kiosk_acquisition(
            1, start=missing_start.isoformat(), end=(current - timedelta(days=1)).isoformat()
        )
        fixture.call(
            "publish_data_kiosk_preprocess",
            {
                "id": new_id(),
                "acquisition_id": acquisition,
                "preprocess_version": "v0",
                "dataset_key": "economics",
                "days": days,
            },
        )


def publish_report(
    fixture: SourceModelFixture,
    company_id: str,
    *,
    start_date: str = "2026-06-01",
    end_date: str = "2026-06-30",
) -> str:
    fill_payout_kiosk_month(fixture, start_date=start_date, end_date=end_date)
    return fixture.call(
        "publish_company_payout_report",
        {
            "id": new_id(),
            "company_id": company_id,
            "seller_namespace": fixture.seller,
            "currency": "USD",
            "start_date": start_date,
            "end_date": end_date,
            "preprocess_version": "v0",
            "settlement_ids": [],
            "marketplace_names": ["Amazon.com"],
            "dataset_key": "economics",
            "report_name": "Retained source evidence",
            "change_reason": "Freeze complete source coverage for retention checks",
        },
    )


@dataclass(frozen=True)
class PayoutInputs:
    company: str
    sku_identity: str
    acquisition: str
    settlement: str
    settlement_version: str
    kiosk_version: str


def prepare_payout(fixture: SourceModelFixture, company: str | None = None) -> PayoutInputs:
    fixture.set_mature_cutoff_date(date(2026, 7, 1))
    if company is None:
        company, identity = fixture.owner()
        fixture.fee(identity, [("2026-01-01", None, "5")])
    else:
        row = fixture.connection.execute(
            "select s.id::text from public.skus s join public.sku_terms_versions v "
            "on v.id=s.current_terms_version_id where s.sku='SKU' and v.company_id=%s",
            (company,),
        ).fetchone()
        if row is None:
            raise AssertionError("Expected the company's shared global SKU.")
        identity = str(row[0])
    acquisition = fixture.acquisition()
    settlement, version = fixture.settlement(
        [fixture.transaction("100")], acquisition_id=acquisition
    )
    _, kiosk = fixture.kiosk(1, [fixture.component("-10")])
    fill_payout_kiosk_month(fixture)
    return PayoutInputs(company, identity, acquisition, settlement, version, kiosk)


def generate_payout_reports(
    fixture: SourceModelFixture,
    user: str,
    company: str,
    month: date = date(2026, 6, 1),
) -> list[tuple[str, bool]]:
    rows = fixture.as_user(
        user,
        "select report_id::text,created from public.generate_company_payout_reports(%s,%s)",
        (company, month),
    )
    return [(str(row[0]), cast(bool, row[1])) for row in rows]


def payout_snapshot(fixture: SourceModelFixture, report: str) -> object:
    row = fixture.connection.execute(
        """
        select jsonb_build_object(
            'header',to_jsonb(r),
            'components',(select jsonb_agg(to_jsonb(c) order by c.row_number)
                from public.company_payout_report_components c where c.report_id=r.id),
            'settlements',(select jsonb_agg(to_jsonb(p) order by p.settlement_id)
                from private.payout_report_settlement_versions p where p.report_id=r.id),
            'kiosk',(select jsonb_agg(to_jsonb(p) order by p.day_id)
                from private.payout_report_data_kiosk_versions p where p.report_id=r.id),
            'terms',(select jsonb_agg(to_jsonb(p) order by p.sku_id)
                from private.payout_report_terms_versions p where p.report_id=r.id),
            'reconciliation',(select jsonb_agg(to_jsonb(c) order by c.row_number)
                from private.payout_report_reconciliation c where c.report_id=r.id)
        ) from public.company_payout_reports r where r.id=%s
    """,
        (report,),
    ).fetchone()
    if row is None:
        raise AssertionError("Expected a saved payout report.")
    return row[0]


def publish_payout(fixture: SourceModelFixture, inputs: PayoutInputs, **scope: object) -> str:
    return fixture.call(
        "publish_company_payout_report",
        {
            "id": new_id(),
            "company_id": inputs.company,
            "seller_namespace": fixture.seller,
            "currency": "USD",
            "start_date": "2026-06-01",
            "end_date": "2026-06-30",
            "preprocess_version": "v0",
            "dataset_key": "economics",
            "settlement_ids": [inputs.settlement],
            "marketplace_names": ["Amazon.com"],
            "report_name": "Saved June report",
            "change_reason": "Initial publication",
            **scope,
        },
    )
