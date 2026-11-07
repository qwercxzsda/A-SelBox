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
    dataset_key: str
    marketplace_name: str | None
    report_name: str
    change_reason: str
    component_count: int
    finances_version_count: int
    data_kiosk_version_count: int
    terms_version_count: int
    source_amount: Decimal
    fee_amount: Decimal
    company_amount: Decimal
    created_at: datetime


@dataclass(frozen=True, slots=True)
class CompanyPayoutRecord:
    """A detail row reconstructed from the report's immutable source and terms references."""

    report_id: str
    source: str
    authoritative: bool
    source_row_id: str
    source_version_id: str
    source_identity_id: str
    sku_id: str
    terms_version_id: str
    fee_period_id: str | None
    sku: str
    marketplace_name: str | None
    activity_date: date
    component_type: str
    currency: str
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
    report_name: str,
    change_reason: str,
    dataset_key: str = "economics",
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
    if dataset_key != "economics":
        raise ValueError("Financial calculations require the economics dataset.")
    payload = {
        "id": str(uuid7()),
        "company_id": normalize_uuid(company_id, "company_id"),
        "marketplace_name": (
            None if marketplace_name is None else validate_marketplace_name(marketplace_name)
        ),
        "currency": None if currency is None else financial_currency(currency),
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "dataset_key": dataset_key,
        "report_name": required_text(report_name, "report_name"),
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
                dataset_key, marketplace_name, report_name,
                change_reason, component_count,
                finances_version_count, data_kiosk_version_count, terms_version_count,
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
            select report_id, source, authoritative, source_row_id,
                source_version_id, source_identity_id, sku_id, terms_version_id,
                fee_period_id, sku, marketplace_name, activity_date, component_type, currency,
                source_amount, quantity, fee_base, fee_rate_percent, fee_amount, company_amount,
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
    if len(row) != 17:
        raise RuntimeError("The payout report query returned an invalid shape.")
    created_at = row[16]
    if not isinstance(created_at, datetime) or created_at.utcoffset() is None:
        raise RuntimeError("created_at must be a timezone-aware datetime.")
    report = CompanyPayoutReport(
        id=normalize_uuid(row[0], "id"),
        company_id=normalize_uuid(row[1], "company_id"),
        currency=None if row[2] is None else financial_currency(row[2]),
        start_date=required_date(row[3], "start_date"),
        end_date=required_date(row[4], "end_date"),
        dataset_key=required_text(row[5], "dataset_key"),
        marketplace_name=_optional_marketplace_name(row[6]),
        report_name=required_text(row[7], "report_name"),
        change_reason=required_text(row[8], "change_reason"),
        component_count=nonnegative_count(row[9], "component_count"),
        finances_version_count=nonnegative_count(row[10], "finances_version_count"),
        data_kiosk_version_count=nonnegative_count(row[11], "data_kiosk_version_count"),
        terms_version_count=nonnegative_count(row[12], "terms_version_count"),
        source_amount=financial_amount(row[13], "source_amount"),
        fee_amount=financial_amount(row[14], "fee_amount"),
        company_amount=financial_amount(row[15], "company_amount"),
        created_at=created_at,
    )
    if report.currency is None and any(
        (
            report.component_count,
            report.source_amount,
            report.fee_amount,
            report.company_amount,
        )
    ):
        raise RuntimeError("A payout without a currency must be an empty aggregate.")
    return report


def _record(row: Sequence[object]) -> CompanyPayoutRecord:
    if len(row) != 21:
        raise RuntimeError("The payout record query returned an invalid shape.")
    source = required_text(row[1], "source")
    status = required_text(row[20], "resolution_status")
    if source not in ("FINANCES", "DATA_KIOSK") or status not in (
        "APPLIED",
        "NOT_APPLICABLE",
        "MISSING_FEE",
    ):
        raise RuntimeError("Payout records must have a known source and resolution status.")
    authoritative = row[2]
    if not isinstance(authoritative, bool):
        raise RuntimeError("authoritative must be a boolean.")
    if authoritative and (
        status not in ("APPLIED", "NOT_APPLICABLE")
        or any(row[index] is None for index in (14, 18, 19))
    ):
        raise RuntimeError("Authoritative payout records must have resolved amounts.")
    sku = row[9]
    if not isinstance(sku, str) or not sku.strip():
        raise RuntimeError("sku must be nonblank source text.")
    return CompanyPayoutRecord(
        report_id=normalize_uuid(row[0], "report_id"),
        source=source,
        authoritative=authoritative,
        source_row_id=normalize_uuid(row[3], "source_row_id"),
        source_version_id=normalize_uuid(row[4], "source_version_id"),
        source_identity_id=normalize_uuid(row[5], "source_identity_id"),
        sku_id=normalize_uuid(row[6], "sku_id"),
        terms_version_id=normalize_uuid(row[7], "terms_version_id"),
        fee_period_id=None if row[8] is None else normalize_uuid(row[8], "fee_period_id"),
        sku=sku,
        marketplace_name=_optional_marketplace_name(row[10]),
        activity_date=required_date(row[11], "activity_date"),
        component_type=required_text(row[12], "component_type"),
        currency=financial_currency(row[13]),
        source_amount=optional_financial_amount(row[14], "source_amount"),
        quantity=optional_financial_amount(row[15], "quantity"),
        fee_base=optional_financial_amount(row[16], "fee_base"),
        fee_rate_percent=optional_financial_amount(row[17], "fee_rate_percent"),
        fee_amount=optional_financial_amount(row[18], "fee_amount"),
        company_amount=optional_financial_amount(row[19], "company_amount"),
        resolution_status=status,
    )
