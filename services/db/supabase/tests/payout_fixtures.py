"""Shared inputs, internal generation, and immutable evidence for payout tests."""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, cast

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id
from services.sync.src.source_serialization import content_sha256


def fill_payout_kiosk_month(
    fixture: SourceModelFixture,
    *,
    start_date: str = "2026-06-01",
    end_date: str = "2026-06-30",
    marketplace: str = "Amazon.com",
) -> None:
    """Publish complete empty source days only where a payout fixture has no version."""
    start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
    existing = {
        row[0]
        for row in fixture.connection.execute(
            "select activity_date from private.data_kiosk_days where seller_namespace=%s "
            "and marketplace_name=%s and dataset_key='economics' "
            "and current_version_id is not null and activity_date between %s and %s",
            (fixture.seller, marketplace, start, end),
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
                    "marketplace_name": marketplace,
                    "activity_date": current.isoformat(),
                    "expected_current_version_id": None,
                    "expected_current_batch_id": None,
                    "content_sha256": content_sha256([]),
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


def _payout_payload(company: str, **scope: object) -> dict[str, object]:
    """Use one default report scope for source selection and publication tests."""
    return {
        "id": new_id(),
        "company_id": company,
        "marketplace_name": "Amazon.com",
        "currency": "USD",
        "start_date": "2026-06-01",
        "end_date": "2026-06-30",
        "dataset_key": "economics",
        "report_name": "Saved June report",
        "change_reason": "Initial publication",
        **scope,
    }


def publish_report(
    fixture: SourceModelFixture,
    company_id: str,
    *,
    start_date: str = "2026-06-01",
    end_date: str = "2026-06-30",
) -> str:
    fill_payout_kiosk_month(fixture, start_date=start_date, end_date=end_date)
    if not fixture.connection.execute(
        "select 1 from private.finances_preprocess_batches p "
        "join private.finances_acquisitions a on a.id=p.acquisition_id "
        "where a.seller_namespace=%s and a.reconciliation_start_date<=%s "
        "and a.reconciliation_end_date>=%s limit 1",
        (fixture.seller, start_date, end_date),
    ).fetchone():
        fixture.finances([], acquisition_id=fixture.acquisition(start=start_date, end=end_date))
    return fixture.call(
        "publish_company_payout_report",
        _payout_payload(
            company_id,
            start_date=start_date,
            end_date=end_date,
            report_name="Retained source evidence",
            change_reason="Freeze source revisions and successful coverage",
        ),
    )


@dataclass(frozen=True)
class PayoutInputs:
    company: str
    sku_identity: str
    acquisition: str
    finances_version: str
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
    _, version = fixture.finances([fixture.transaction("100")], acquisition_id=acquisition)
    _, kiosk = fixture.kiosk(1, [fixture.component("-10")])
    fill_payout_kiosk_month(fixture)
    if version is None:
        raise AssertionError("Expected a nonempty Finance revision.")
    return PayoutInputs(
        company=company,
        sku_identity=identity,
        acquisition=acquisition,
        finances_version=version,
        kiosk_version=kiosk,
    )


def generate_payout_reports(
    fixture: SourceModelFixture,
    company: str,
    month: date = date(2026, 6, 1),
) -> list[tuple[str, bool]]:
    with fixture.connection.transaction():
        rows = fixture.connection.execute(
            "select report_id::text,created from private.generate_company_payout_reports(%s,%s)",
            (company, month),
        ).fetchall()
    return [(str(row[0]), cast(bool, row[1])) for row in rows]


def refresh_payout_reports(
    fixture: SourceModelFixture, limit: int = 10
) -> tuple[int, int, int, int]:
    """Run the same privileged pending-work batch as the scheduled database job."""
    with fixture.connection.transaction():
        rows = fixture.connection.execute(
            "select * from private.refresh_company_payout_reports(%s)", (limit,)
        ).fetchall()
    if len(rows) != 1:
        raise AssertionError("Expected one payout refresh summary.")
    return cast(tuple[int, int, int, int], rows[0])


def payout_snapshot(fixture: SourceModelFixture, report: str) -> object:
    """Capture persisted totals and revision references without derived rows."""
    row = fixture.connection.execute(
        """
        select jsonb_build_object(
            'header',to_jsonb(r),
            'finances_versions',(select jsonb_agg(to_jsonb(p) order by p.transaction_id)
                from private.payout_report_finances_versions p where p.report_id=r.id),
            'data_kiosk_versions',(select jsonb_agg(to_jsonb(p) order by p.day_id)
                from private.payout_report_data_kiosk_versions p where p.report_id=r.id),
            'terms_versions',(select jsonb_agg(to_jsonb(p) order by p.sku_id)
                from private.payout_report_terms_versions p where p.report_id=r.id)
        ) from public.company_payout_reports r where r.id=%s
    """,
        (report,),
    ).fetchone()
    if row is None:
        raise AssertionError("Expected a saved payout report.")
    return row[0]


def report_records(
    fixture: SourceModelFixture,
    report: str,
    *,
    user: str | None = None,
    authoritative: bool | None = None,
) -> list[dict[str, Any]]:
    """Read all permitted records, or one explicit scope through its paginated RPC."""
    if authoritative is None:
        query = (
            "select coalesce(jsonb_agg((select jsonb_object_agg(key,value) "
            "from jsonb_each_text(to_jsonb(r))) "
            "order by r.source,r.source_identity_id,r.source_row_id),'[]'::jsonb) "
            "from private.read_payout_report_records(%s) r"
        )
        result = (
            require_row(fixture.connection.execute(query, (report,)).fetchone())[0]
            if user is None
            else fixture.as_user(user, query, (report,))[0][0]
        )
        return cast(list[dict[str, Any]], result)
    records: list[dict[str, Any]] = []
    while True:
        query = "select public.payout_report_records(%s,%s,1000,%s)"
        parameters = (report, authoritative, len(records))
        result = (
            require_row(fixture.connection.execute(query, parameters).fetchone())[0]
            if user is None
            else fixture.as_user(user, query, parameters)[0][0]
        )
        page = cast(dict[str, Any], result)
        rows = cast(list[dict[str, Any]], page["rows"])
        records.extend(rows)
        if len(records) >= int(page["total_count"]):
            return records
        if not rows:
            raise AssertionError("Payout records ended before their exact count.")


def report_source_rows(
    fixture: SourceModelFixture, administrator: str, report: str, *, grouping: str = "total"
) -> list[dict[str, Any]]:
    """Read raw category aggregates through the administrator's report scope."""
    result = fixture.as_user(
        administrator, "select public.report_source_totals(%s,%s)", (report, grouping)
    )[0][0]
    return cast(dict[str, Any], result)["rows"]


def publish_payout(fixture: SourceModelFixture, inputs: PayoutInputs, **scope: object) -> str:
    return fixture.call("publish_company_payout_report", _payout_payload(inputs.company, **scope))


def reassign_payout_sku(fixture: SourceModelFixture, sku_id: str, company: str | None) -> None:
    sku, version = require_row(
        fixture.connection.execute(
            "select sku,current_terms_version_id::text from public.skus where id=%s", (sku_id,)
        ).fetchone()
    )
    fixture.call(
        "publish_sku_terms",
        {
            "id": new_id(),
            "sku_id": sku_id,
            "sku": sku,
            "company_id": company,
            "expected_current_version_id": version,
            "change_reason": "Change assignment eligibility",
            "periods": [
                {
                    "id": new_id(),
                    "marketplace_name": "Amazon.com",
                    "valid_from": "2026-01-01",
                    "valid_to": None,
                    "fee_rate_percent": "5",
                }
            ],
        },
    )


def empty_report_payload(company: str) -> dict[str, object]:
    return _payout_payload(
        company,
        marketplace_name=None,
        currency=None,
        report_name="June payout",
        change_reason="Verify current assignment requirement",
    )
