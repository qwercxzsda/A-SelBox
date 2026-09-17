"""Create payout evidence through the actual immutable report publisher."""

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


def publish_report(
    fixture: SourceModelFixture,
    company_id: str,
    *,
    start_date: str = "2026-06-15",
    end_date: str = "2026-06-15",
) -> str:
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
