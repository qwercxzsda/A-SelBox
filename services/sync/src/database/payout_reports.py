"""Publish and read immutable company payout reports with exact saved amounts."""

from calendar import monthrange
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from uuid import uuid7

from ..amazon.marketplace_names import validate_marketplace_name
from .connection import DatabaseConnection
from .financial_values import (
    financial_amount,
    financial_currency,
    nonnegative_count,
    optional_financial_amount,
)
from .publication import publish_json
from .values import normalize_uuid, required_date, required_text


@dataclass(frozen=True, slots=True)
class CompanyPayoutReport:
    """One exact company/month/marketplace snapshot with a separate currency unit."""

    id: str
    company_id: str
    currency: str | None
    start_date: date
    end_date: date
    marketplace_name: str | None
    change_reason: str
    record_count: int
    source_version_count: int
    assignment_version_count: int
    source_amount: Decimal
    fee_amount: Decimal
    company_amount: Decimal
    created_at: datetime


@dataclass(frozen=True, slots=True)
class CompanyPayoutRecord:
    """A detail row reconstructed from the report's immutable source and terms references."""

    report_id: str
    source: str
    source_row_id: str
    source_version_id: str
    source_identity_id: str
    sku_id: str | None
    terms_version_id: str | None
    fee_period_id: str | None
    sku: str | None
    marketplace_name: str | None
    activity_date: date
    component_type: str
    currency: str
    base_amount: Decimal
    tax_amount: Decimal
    source_amount: Decimal | None
    quantity: Decimal | None
    fee_base: Decimal | None
    fee_rate_percent: Decimal | None
    fee_amount: Decimal | None
    company_amount: Decimal | None
    resolution_status: str

    @property
    def identity(self) -> tuple[str, str, str]:
        """Identify the same source row within the same report without another stored UUID."""
        return self.report_id, self.source, self.source_row_id


def publish_company_payout_report(
    database: DatabaseConnection,
    *,
    company_id: str,
    marketplace_name: str | None,
    currency: str | None,
    start_date: date,
    end_date: date,
    change_reason: str,
) -> str:
    """Save current source and terms revisions, or reuse the matching latest report.

    The database selects immutable revisions and validates successful coverage;
    callers supply only the company/month/marketplace/currency scope. Reprocessing
    unchanged revisions preserves report identity. A null currency represents an
    empty aggregate with no known currency. Publication requires a current SKU
    assignment; saved reports remain readable after ownership changes.
    """
    required_date(start_date, "start_date")
    required_date(end_date, "end_date")
    if start_date.day != 1 or end_date != start_date.replace(
        day=monthrange(start_date.year, start_date.month)[1]
    ):
        raise ValueError("A payout report must cover exactly one complete calendar month.")
    payload = {
        "id": str(uuid7()),
        "company_id": normalize_uuid(company_id, "company_id"),
        "marketplace_name": (
            None if marketplace_name is None else validate_marketplace_name(marketplace_name)
        ),
        "currency": None if currency is None else financial_currency(currency),
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "change_reason": required_text(change_reason, "change_reason"),
    }
    return publish_json(
        database,
        "SELECT private.publish_company_payout_report(%(payload)s)",
        payload,
    )


def load_company_payout_report(
    database: DatabaseConnection, report_id: str
) -> CompanyPayoutReport | None:
    """Read saved amounts and counts of referenced source and terms revisions."""
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select id, company_id, currency, start_date, end_date,
                marketplace_name,
                change_reason, record_count,
                source_version_count, assignment_version_count,
                source_amount, fee_amount, company_amount, created_at
            from public.company_payout_reports where id = %(id)s::uuid
            """,
            {"id": normalize_uuid(report_id, "report_id")},
        )
        row = cursor.fetchone()
    return None if row is None else _report(row)


def load_company_payout_report_records(
    database: DatabaseConnection, report_id: str
) -> tuple[CompanyPayoutRecord, ...]:
    """Reconstruct authorized records using saved revisions and ownership, in stable order."""
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select report_id, source, source_row_id,
                source_version_id, source_identity_id, sku_id, terms_version_id,
                fee_period_id, sku, marketplace_name, activity_date, component_type, currency,
                base_amount, tax_amount, source_amount, quantity, fee_base, fee_rate_percent,
                fee_amount, company_amount,
                resolution_status
            from private.read_payout_report_records(%(id)s::uuid)
            order by source, source_identity_id, source_row_id
            """,
            {"id": normalize_uuid(report_id, "report_id")},
        )
        return tuple(_record(row) for row in cursor.fetchall())


def _optional_marketplace_name(value: object) -> str | None:
    """Keep an unspecified marketplace distinct from a validated saved name."""
    return (
        None
        if value is None
        else validate_marketplace_name(required_text(value, "marketplace_name"))
    )


def _report(row: Sequence[object]) -> CompanyPayoutReport:
    if len(row) != 14:
        raise RuntimeError("The payout report query returned an invalid shape.")
    created_at = row[13]
    if not isinstance(created_at, datetime) or created_at.utcoffset() is None:
        raise RuntimeError("created_at must be a timezone-aware datetime.")
    report = CompanyPayoutReport(
        id=normalize_uuid(row[0], "id"),
        company_id=normalize_uuid(row[1], "company_id"),
        currency=None if row[2] is None else financial_currency(row[2]),
        start_date=required_date(row[3], "start_date"),
        end_date=required_date(row[4], "end_date"),
        marketplace_name=_optional_marketplace_name(row[5]),
        change_reason=required_text(row[6], "change_reason"),
        record_count=nonnegative_count(row[7], "record_count"),
        source_version_count=nonnegative_count(row[8], "source_version_count"),
        assignment_version_count=nonnegative_count(row[9], "assignment_version_count"),
        source_amount=financial_amount(row[10], "source_amount"),
        fee_amount=financial_amount(row[11], "fee_amount"),
        company_amount=financial_amount(row[12], "company_amount"),
        created_at=created_at,
    )
    if report.currency is None and any(
        (
            report.record_count,
            report.source_amount,
            report.fee_amount,
            report.company_amount,
        )
    ):
        raise RuntimeError("A payout without a currency must be an empty aggregate.")
    return report


def _record(row: Sequence[object]) -> CompanyPayoutRecord:
    if len(row) != 22:
        raise RuntimeError("The payout record query returned an invalid shape.")
    return CompanyPayoutRecord(
        report_id=normalize_uuid(row[0], "report_id"),
        source=required_text(row[1], "source"),
        source_row_id=normalize_uuid(row[2], "source_row_id"),
        source_version_id=normalize_uuid(row[3], "source_version_id"),
        source_identity_id=normalize_uuid(row[4], "source_identity_id"),
        sku_id=None if row[5] is None else normalize_uuid(row[5], "sku_id"),
        terms_version_id=None if row[6] is None else normalize_uuid(row[6], "terms_version_id"),
        fee_period_id=None if row[7] is None else normalize_uuid(row[7], "fee_period_id"),
        sku=None if row[8] is None else required_text(row[8], "sku"),
        marketplace_name=_optional_marketplace_name(row[9]),
        activity_date=required_date(row[10], "activity_date"),
        component_type=required_text(row[11], "component_type"),
        currency=financial_currency(row[12]),
        base_amount=financial_amount(row[13], "base_amount"),
        tax_amount=financial_amount(row[14], "tax_amount"),
        source_amount=financial_amount(row[15], "source_amount"),
        quantity=optional_financial_amount(row[16], "quantity"),
        fee_base=optional_financial_amount(row[17], "fee_base"),
        fee_rate_percent=optional_financial_amount(row[18], "fee_rate_percent"),
        fee_amount=financial_amount(row[19], "fee_amount"),
        company_amount=financial_amount(row[20], "company_amount"),
        resolution_status=required_text(row[21], "resolution_status"),
    )
