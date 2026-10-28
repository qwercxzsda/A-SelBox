"""Publish native monthly captures and immutable daily snapshots for DB regression tests."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from services.db.supabase.tests.local_database import require_row
from services.sync.src.amazon.financial_channels import FINANCIAL_CHANNELS
from services.sync.src.amazon.marketplace_names import MARKETPLACE_NAME_BY_ID
from services.sync.src.amazon.marketplaces import CREDENTIAL_SCOPES
from services.sync.src.finances.marketplaces import financial_marketplace_timezone

if TYPE_CHECKING:
    from services.db.supabase.tests.source_fixtures import SourceModelFixture


def acquisition(
    self: SourceModelFixture,
    *,
    capture_label: str = "capture",
    digest: str = "a",
    start: str = "2026-06-01",
    end: str = "2026-06-30",
    marketplace: str = "Amazon.com",
    marketplace_id: str = "ATVPDKIKX0DER",
    time_zone: str = "America/Los_Angeles",
    amazon_scope: str = "NA",
) -> str:
    from services.db.supabase.tests.source_fixtures import archive_document, new_id

    timestamp = datetime.now(UTC).isoformat()
    summary_available = marketplace_id not in FINANCIAL_CHANNELS
    local_start = datetime.combine(date.fromisoformat(start), time.min, ZoneInfo(time_zone))
    local_end = datetime.combine(
        date.fromisoformat(end) + timedelta(days=1), time.min, ZoneInfo(time_zone)
    )
    return self.call(
        "publish_finances_acquisition",
        {
            "id": new_id(),
            "seller_namespace": self.seller,
            "amazon_scope": amazon_scope,
            "api_version": "2024-06-19",
            "capture_started_at": timestamp,
            "downloaded_at": timestamp,
            "query_start_date": start,
            "query_end_date": end,
            "marketplace_ids": [marketplace_id],
            "api_metadata": {
                "coverage_marketplaces": [
                    {
                        "marketplace_id": marketplace_id,
                        "marketplace_name": marketplace,
                        "time_zone": time_zone,
                    }
                ],
                "summary_available": summary_available,
                "capture_label": capture_label,
            },
            "documents": [
                {
                    "operation": operation,
                    "page_number": 1,
                    "marketplace_id": None,
                    "is_terminal": True,
                    "request_parameters": {
                        "postedAfter": local_start.astimezone(UTC).isoformat(),
                        "postedBefore": local_end.astimezone(UTC).isoformat(),
                    }
                    if operation == "transactions"
                    else {"periodStart": start, "periodEnd": end},
                    "requested_at": timestamp,
                    "received_at": timestamp,
                    "document": archive_document(digest),
                    "api_metadata": {},
                }
                for operation in (
                    ("transactions", "summary") if summary_available else ("transactions",)
                )
            ],
        },
    )


def finances(
    self: SourceModelFixture,
    rows: list[dict[str, object]],
    *,
    acquisition_id: str | None = None,
    expected: str | None = None,
    version: str = "v0",
    identity: str = "finances",
) -> tuple[str, str]:
    """Publish independent monthly captures using the same daily replacement rules."""
    from calendar import monthrange

    if acquisition_id is not None:
        return _finances_capture(
            self, rows, acquisition_id=acquisition_id, expected=expected, version=version
        )
    if any(not isinstance(row.get("marketplace_name"), str) for row in rows):
        raise ValueError("Fixture Finances transactions require their explicit native marketplace.")
    scopes = sorted(
        {
            (
                date.fromisoformat(str(row["posted_date"])).replace(day=1),
                str(row["marketplace_name"]),
            )
            for row in rows
        }
    ) or [(date(2026, 6, 1), "Amazon.com")]
    result = None
    representative = str(rows[0]["posted_date"]) if rows else scopes[0][0].isoformat()
    representative_market = str(rows[0]["marketplace_name"]) if rows else "Amazon.com"
    identifiers = {name: identifier for identifier, name in MARKETPLACE_NAME_BY_ID.items()}
    identifiers.update(
        {channel.marketplace_name: identifier for identifier, channel in FINANCIAL_CHANNELS.items()}
    )
    for month, marketplace in scopes:
        end = month.replace(day=monthrange(month.year, month.month)[1])
        selected = [
            row
            for row in rows
            if month.isoformat() <= str(row["posted_date"]) <= end.isoformat()
            and row["marketplace_name"] == marketplace
        ]
        marketplace_id = identifiers[marketplace]
        channel = FINANCIAL_CHANNELS.get(marketplace_id)
        amazon_scope = (
            channel.amazon_scope
            if channel is not None
            else next(
                name
                for name, scope in CREDENTIAL_SCOPES.items()
                if marketplace_id in scope.marketplace_ids
            )
        )
        capture = self.acquisition(
            capture_label=identity,
            start=month.isoformat(),
            end=end.isoformat(),
            marketplace=marketplace,
            marketplace_id=marketplace_id,
            time_zone=financial_marketplace_timezone(marketplace_id).key,
            amazon_scope=amazon_scope,
        )
        current = _finances_capture(
            self,
            selected,
            acquisition_id=capture,
            expected=expected
            if month.isoformat() <= representative <= end.isoformat()
            and marketplace == representative_market
            else None,
            version=version,
        )
        if (
            month.isoformat() <= representative <= end.isoformat()
            and marketplace == representative_market
        ):
            result = current
    if result is None:
        raise AssertionError("Fixture did not publish its representative source day.")
    return result


def _finances_capture(
    self: SourceModelFixture,
    rows: list[dict[str, object]],
    *,
    acquisition_id: str,
    expected: str | None = None,
    version: str = "v0",
) -> tuple[str, str]:
    """Publish complete native day observations, including empty covered days."""
    from calendar import monthrange
    from datetime import timedelta

    from services.db.supabase.tests.source_fixtures import new_id

    acquisition = require_row(
        self.connection.execute(
            "select query_start_date,query_end_date,api_metadata "
            "from private.finances_acquisitions where id=%s",
            (acquisition_id,),
        ).fetchone()
    )
    start, end, metadata = acquisition
    market = metadata["coverage_marketplaces"][0]
    if any(row.get("marketplace_name") != market["marketplace_name"] for row in rows):
        raise ValueError("Fixture transaction marketplace differs from explicit capture scope.")
    days: list[dict[str, object]] = []
    activity = start
    representative = str(rows[0]["posted_date"]) if rows else start.isoformat()
    expected_activity = representative
    if expected is not None:
        previous_day = self.connection.execute(
            "select d.activity_date from private.finances_days d "
            "join private.finances_preprocess_versions v on v.day_id=d.id where v.id=%s",
            (expected,),
        ).fetchone()
        if previous_day:
            expected_activity = previous_day[0].isoformat()
            if not rows:
                representative = expected_activity
    selected_id = None
    while activity <= end:
        current = self.connection.execute(
            "select current_version_id from private.finances_days where seller_namespace=%s "
            "and marketplace_name=%s and activity_date=%s",
            (self.seller, market["marketplace_name"], activity),
        ).fetchone()
        day_id = new_id()
        if activity.isoformat() == representative:
            selected_id = day_id
        day_rows = [row for row in rows if row["posted_date"] == activity.isoformat()]
        parents: list[dict[str, object]] = []
        for index, row in enumerate(day_rows, 1):
            native = str(row.get("native_transaction_id", row["id"]))
            component = dict(row)
            component["component_key"] = str(row.get("component_key", native))
            parent: dict[str, object] = {
                "id": new_id(),
                "native_transaction_id": native,
                "account_type": row.get("account_type", "STANDARD_ORDERS"),
                "transaction_type": row["transaction_type"],
                "transaction_status": row.get("transaction_status", "RELEASED"),
                "posted_at": row["posted_at"],
                "currency": row["currency"],
                "total_amount": row["amount"],
                "deferred_transaction_id": row.get("deferred_transaction_id"),
                "release_transaction_id": row.get("release_transaction_id"),
                "activity_eligible": row.get("activity_eligible", True),
                "source_page_number": 1,
                "source_record_number": row.get("source_record_number", index),
                "source_fields": {},
                "components": [component],
            }
            parents.append(parent)
        days.append(
            {
                "id": day_id,
                "marketplace_name": market["marketplace_name"],
                "marketplace_id": market["marketplace_id"],
                "activity_date": activity.isoformat(),
                "expected_current_version_id": (
                    expected
                    if activity.isoformat() == expected_activity and expected is not None
                    else str(current[0])
                    if current
                    else None
                ),
                "content_sha256": "a" * 64,
                "transactions": parents,
            }
        )
        activity += timedelta(days=1)
    summaries: list[dict[str, object]] = []
    activity = start.replace(day=1)
    while activity <= end:
        finish = activity.replace(day=monthrange(activity.year, activity.month)[1])
        if activity >= start and finish <= end and metadata["summary_available"]:
            scopes = {
                (str(row.get("account_type", "STANDARD_ORDERS")), str(row["currency"]))
                for row in rows
            } or {("STANDARD_ORDERS", "USD")}
            for account, currency in scopes:
                total = sum(
                    (
                        Decimal(str(row["amount"]))
                        for row in rows
                        if activity.isoformat() <= str(row["posted_date"]) <= finish.isoformat()
                        and row.get("account_type", "STANDARD_ORDERS") == account
                        and row["currency"] == currency
                        and row.get("activity_eligible", True)
                    ),
                    Decimal(0),
                )
                summaries.append(
                    {
                        "marketplace_id": market["marketplace_id"],
                        "marketplace_name": market["marketplace_name"],
                        "account_type": account,
                        "currency": currency,
                        "period_start": activity.isoformat(),
                        "period_end": finish.isoformat(),
                        "net_proceeds": str(total),
                        "source_page_number": 1,
                        "source_summary_index": len(summaries) + 1,
                    }
                )
        activity = finish + timedelta(days=1)
    self.call(
        "publish_finances_preprocess",
        {
            "id": new_id(),
            "acquisition_id": acquisition_id,
            "preprocess_version": version,
            "days": days,
            "summaries": summaries,
        },
    )
    found = require_row(
        self.connection.execute(
            "select day_id from private.finances_preprocess_versions where id=%s",
            (selected_id,),
        ).fetchone()
    )
    return str(found[0]), str(selected_id)
