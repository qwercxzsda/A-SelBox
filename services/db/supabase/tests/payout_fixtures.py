"""Shared inputs, internal generation, and immutable evidence for payout tests."""

from dataclasses import dataclass
from datetime import date
from typing import Any, cast

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import (
    SourceModelFixture,
    new_id,
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
    if not fixture.connection.execute(
        "select 1 from private.source_preprocess_batches p "
        "join private.source_acquisitions a on a.id=p.acquisition_id "
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
            change_reason="Freeze source revisions and successful coverage",
        ),
    )


@dataclass(frozen=True)
class PayoutInputs:
    company: str
    sku_identity: str
    acquisition: str
    finances_version: str


def prepare_payout(fixture: SourceModelFixture, company: str | None = None) -> PayoutInputs:
    fixture.set_mature_cutoff_date(date(2026, 7, 1))
    if company is None:
        company, identity = fixture.owner()
        fixture.fee(identity, [("2026-01-01", None, "5")])
    else:
        row = fixture.connection.execute(
            "select s.id::text from public.assignment_keys s join public.assignment_versions v "
            "on v.id=s.current_version_id where s.kind='SKU' and s.native_id='SKU' and "
            "v.company_id=%s",
            (company,),
        ).fetchone()
        if row is None:
            raise AssertionError("Expected the company's shared global SKU.")
        identity = str(row[0])
    acquisition = fixture.acquisition()
    _, version = fixture.finances([fixture.transaction("100")], acquisition_id=acquisition)
    if version is None:
        raise AssertionError("Expected a nonempty Finance revision.")
    return PayoutInputs(
        company=company,
        sku_identity=identity,
        acquisition=acquisition,
        finances_version=version,
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
            'source_versions',(select jsonb_agg(to_jsonb(p) order by p.unit_id)
                from private.payout_report_source_versions p where p.report_id=r.id),
            'assignment_versions',(select jsonb_agg(to_jsonb(p) order by p.key_id)
                from private.payout_report_assignment_versions p where p.report_id=r.id)
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
) -> list[dict[str, Any]]:
    """Read all permitted records, or one explicit scope through its paginated RPC."""
    records: list[dict[str, Any]] = []
    while True:
        query = "select public.payout_report_records(%s,1000,%s)"
        parameters = (report, len(records))
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


def publish_payout(fixture: SourceModelFixture, inputs: PayoutInputs, **scope: object) -> str:
    return fixture.call("publish_company_payout_report", _payout_payload(inputs.company, **scope))


def reassign_payout_sku(fixture: SourceModelFixture, sku_id: str, company: str | None) -> None:
    sku, version = require_row(
        fixture.connection.execute(
            "select native_id,current_version_id::text from public.assignment_keys where id=%s",
            (sku_id,),
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
        change_reason="Verify current assignment requirement",
    )
