"""Publish and read immutable company payout reports with exact saved amounts."""

from calendar import monthrange
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import cast
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
from .seller_namespaces import validate_seller_namespace
from .values import normalize_uuid, required_date, required_text


@dataclass(frozen=True, slots=True)
class CompanyPayoutReport:
    """One saved company/month aggregate across sources, separated only by currency."""

    id: str
    company_id: str
    currency: str | None
    start_date: date
    end_date: date
    dataset_key: str
    marketplace_names: tuple[str, ...]
    report_name: str
    change_reason: str
    calculation_version: str
    component_count: int
    reconciliation_count: int
    settlement_version_count: int
    data_kiosk_version_count: int
    terms_version_count: int
    source_amount: Decimal
    fee_amount: Decimal
    company_amount: Decimal
    created_at: datetime


@dataclass(frozen=True, slots=True)
class CompanyPayoutComponent:
    """Saved component values and exact source/terms references, never live joins."""

    id: str
    report_id: str
    row_number: int
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
    source_amount: Decimal | None
    quantity: Decimal | None
    fee_base: Decimal | None
    fee_rate_percent: Decimal | None
    fee_amount: Decimal | None
    company_amount: Decimal | None
    resolution_status: str


@dataclass(frozen=True, slots=True)
class CompanyPayoutReconciliation:
    """Seller-wide daily controls, repeated per report and restricted to administrators."""

    report_id: str
    row_number: int
    seller_namespace: str
    activity_date: date
    marketplace_name: str | None
    currency: str
    settlement_category_amount: Decimal
    selbox_category_amount: Decimal
    data_kiosk_settlement_control: Decimal
    data_kiosk_category_amount: Decimal
    difference: Decimal
    settlement_total: Decimal
    accounted_total: Decimal


def publish_company_payout_report(
    database: DatabaseConnection,
    *,
    company_id: str,
    currency: str | None,
    start_date: date,
    end_date: date,
    report_name: str,
    change_reason: str,
    dataset_key: str = "economics",
) -> str:
    """Save or reuse monetary amounts, supporting details, and exact source evidence.

    The database discovers all company source namespaces and validates coverage
    before computing amounts. No source selection or amounts come from callers.
    Matching immutable inputs return the latest report's identity. A null currency
    is valid only for an empty company/month with no known currency.
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
    """Read the saved report header and its complete inventory counts."""
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select id, company_id, currency, start_date, end_date,
                dataset_key, marketplace_names, report_name,
                change_reason, calculation_version, component_count, reconciliation_count,
                settlement_version_count, data_kiosk_version_count, terms_version_count,
                source_amount, fee_amount, company_amount, created_at
            from public.company_payout_reports where id = %(id)s::uuid
            """,
            {"id": normalize_uuid(report_id, "report_id")},
        )
        row = cursor.fetchone()
    return None if row is None else _report(row)


def load_company_payout_report_components(
    database: DatabaseConnection, report_id: str
) -> tuple[CompanyPayoutComponent, ...]:
    """Read saved components in their stable report order."""
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select id, report_id, row_number, source, authoritative, source_row_id,
                source_version_id, source_identity_id, sku_id, terms_version_id,
                fee_period_id, sku, marketplace_name, activity_date, component_type,
                source_amount, quantity, fee_base, fee_rate_percent, fee_amount, company_amount,
                resolution_status
            from public.company_payout_report_components
            where report_id = %(id)s::uuid order by row_number
            """,
            {"id": normalize_uuid(report_id, "report_id")},
        )
        return tuple(_component(row) for row in cursor.fetchall())


def load_company_payout_reconciliation(
    database: DatabaseConnection, report_id: str
) -> tuple[CompanyPayoutReconciliation, ...]:
    """Read saved seller controls; these amounts never add to a company payout."""
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select report_id, row_number, seller_namespace, activity_date, marketplace_name,
                currency, settlement_category_amount, selbox_category_amount,
                data_kiosk_settlement_control,
                data_kiosk_category_amount, difference, settlement_total, accounted_total
            from public.payout_report_reconciliation
            where report_id = %(id)s::uuid order by row_number
            """,
            {"id": normalize_uuid(report_id, "report_id")},
        )
        return tuple(_reconciliation(row) for row in cursor.fetchall())


def _report(row: Sequence[object]) -> CompanyPayoutReport:
    if len(row) != 19:
        raise RuntimeError("The payout report query returned an invalid shape.")
    created_at = row[18]
    if not isinstance(created_at, datetime) or created_at.utcoffset() is None:
        raise RuntimeError("created_at must be a timezone-aware datetime.")
    calculation_version = required_text(row[9], "calculation_version")
    if calculation_version != "v1":
        raise RuntimeError("Unsupported payout calculation version.")
    report = CompanyPayoutReport(
        id=normalize_uuid(row[0], "id"),
        company_id=normalize_uuid(row[1], "company_id"),
        currency=None if row[2] is None else financial_currency(row[2]),
        start_date=required_date(row[3], "start_date"),
        end_date=required_date(row[4], "end_date"),
        dataset_key=required_text(row[5], "dataset_key"),
        marketplace_names=_marketplaces(row[6]),
        report_name=required_text(row[7], "report_name"),
        change_reason=required_text(row[8], "change_reason"),
        calculation_version=calculation_version,
        component_count=nonnegative_count(row[10], "component_count"),
        reconciliation_count=nonnegative_count(row[11], "reconciliation_count"),
        settlement_version_count=nonnegative_count(row[12], "settlement_version_count"),
        data_kiosk_version_count=nonnegative_count(row[13], "data_kiosk_version_count"),
        terms_version_count=nonnegative_count(row[14], "terms_version_count"),
        source_amount=financial_amount(row[15], "source_amount"),
        fee_amount=financial_amount(row[16], "fee_amount"),
        company_amount=financial_amount(row[17], "company_amount"),
        created_at=created_at,
    )
    if report.currency is None and any(
        (
            report.component_count,
            report.reconciliation_count,
            report.source_amount,
            report.fee_amount,
            report.company_amount,
            report.marketplace_names,
        )
    ):
        raise RuntimeError("A payout without a currency must be an empty aggregate.")
    return report


def _component(row: Sequence[object]) -> CompanyPayoutComponent:
    if len(row) != 22:
        raise RuntimeError("The payout component query returned an invalid shape.")
    source = required_text(row[3], "source")
    status = required_text(row[21], "resolution_status")
    if source not in ("SETTLEMENT", "DATA_KIOSK") or status not in (
        "APPLIED",
        "NOT_APPLICABLE",
        "MISSING_FEE",
    ):
        raise RuntimeError("Payout components must have a known source and resolution status.")
    authoritative = row[4]
    if not isinstance(authoritative, bool):
        raise RuntimeError("authoritative must be a boolean.")
    if authoritative and (
        status not in ("APPLIED", "NOT_APPLICABLE")
        or any(row[index] is None for index in (15, 19, 20))
    ):
        raise RuntimeError("Authoritative payout components must have resolved amounts.")
    sku = row[11]
    if not isinstance(sku, str) or not sku.strip():
        raise RuntimeError("sku must be nonblank source text.")
    return CompanyPayoutComponent(
        id=normalize_uuid(row[0], "id"),
        report_id=normalize_uuid(row[1], "report_id"),
        row_number=nonnegative_count(row[2], "row_number"),
        source=source,
        authoritative=authoritative,
        source_row_id=normalize_uuid(row[5], "source_row_id"),
        source_version_id=normalize_uuid(row[6], "source_version_id"),
        source_identity_id=normalize_uuid(row[7], "source_identity_id"),
        sku_id=normalize_uuid(row[8], "sku_id"),
        terms_version_id=normalize_uuid(row[9], "terms_version_id"),
        fee_period_id=None if row[10] is None else normalize_uuid(row[10], "fee_period_id"),
        sku=sku,
        marketplace_name=(
            None
            if row[12] is None
            else validate_marketplace_name(required_text(row[12], "marketplace_name"))
        ),
        activity_date=required_date(row[13], "activity_date"),
        component_type=required_text(row[14], "component_type"),
        source_amount=optional_financial_amount(row[15], "source_amount"),
        quantity=optional_financial_amount(row[16], "quantity"),
        fee_base=optional_financial_amount(row[17], "fee_base"),
        fee_rate_percent=optional_financial_amount(row[18], "fee_rate_percent"),
        fee_amount=optional_financial_amount(row[19], "fee_amount"),
        company_amount=optional_financial_amount(row[20], "company_amount"),
        resolution_status=status,
    )


def _reconciliation(row: Sequence[object]) -> CompanyPayoutReconciliation:
    if len(row) != 13:
        raise RuntimeError("The payout reconciliation query returned an invalid shape.")
    return CompanyPayoutReconciliation(
        report_id=normalize_uuid(row[0], "report_id"),
        row_number=nonnegative_count(row[1], "row_number"),
        seller_namespace=validate_seller_namespace(required_text(row[2], "seller_namespace")),
        activity_date=required_date(row[3], "activity_date"),
        marketplace_name=(
            None
            if row[4] is None
            else validate_marketplace_name(required_text(row[4], "marketplace_name"))
        ),
        currency=financial_currency(row[5]),
        settlement_category_amount=financial_amount(row[6], "settlement_category_amount"),
        selbox_category_amount=financial_amount(row[7], "selbox_category_amount"),
        data_kiosk_settlement_control=financial_amount(row[8], "data_kiosk_settlement_control"),
        data_kiosk_category_amount=financial_amount(row[9], "data_kiosk_category_amount"),
        difference=financial_amount(row[10], "difference"),
        settlement_total=financial_amount(row[11], "settlement_total"),
        accounted_total=financial_amount(row[12], "accounted_total"),
    )


def _marketplaces(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise RuntimeError("marketplace_names must be an array.")
    return tuple(
        validate_marketplace_name(required_text(item, "marketplace_name"))
        for item in cast(list[object], value)
    )
