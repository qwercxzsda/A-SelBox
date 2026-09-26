"""Publish and read immutable company payout reports with exact saved amounts."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import cast
from uuid import uuid7

from ..amazon.marketplace_names import validate_marketplace_name
from .connection import DatabaseConnection
from .financial_scope import financial_scope_parameters
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
    """One saved company/currency result; it is not a payment instruction."""

    id: str
    company_id: str
    seller_namespace: str
    currency: str
    start_date: date
    end_date: date
    preprocess_version: str
    dataset_key: str
    marketplace_names: tuple[str, ...]
    report_name: str
    change_reason: str
    calculation_version: str
    component_count: int
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
    source_row_id: str
    source_version_id: str
    source_identity_id: str
    seller_sku_id: str
    terms_version_id: str
    fee_period_id: str | None
    sku: str
    marketplace_name: str | None
    activity_date: date
    component_type: str
    source_amount: Decimal
    quantity: Decimal | None
    fee_base: Decimal | None
    fee_rate_percent: Decimal | None
    fee_amount: Decimal
    company_amount: Decimal
    resolution_status: str


def publish_company_payout_report(
    database: DatabaseConnection,
    *,
    company_id: str,
    seller_namespace: str,
    currency: str,
    start_date: date,
    end_date: date,
    preprocess_version: str,
    settlement_ids: Sequence[str],
    marketplace_names: Sequence[str],
    report_name: str,
    change_reason: str,
    dataset_key: str = "economics",
) -> str:
    """Freeze a fully resolved report and its exact evidence in one transaction.

    The database selects and validates the declared complete source scope before
    filtering to the requested company and currency. No amounts come from callers.
    """
    report_id = str(uuid7())
    payload = financial_scope_parameters(
        seller_namespace=seller_namespace,
        start_date=start_date,
        end_date=end_date,
        preprocess_version=preprocess_version,
        settlement_ids=settlement_ids,
        marketplace_names=marketplace_names,
        dataset_key=dataset_key,
    )
    payload.update(
        id=report_id,
        company_id=normalize_uuid(company_id, "company_id"),
        currency=financial_currency(currency),
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
        report_name=required_text(report_name, "report_name"),
        change_reason=required_text(change_reason, "change_reason"),
    )
    return publish_json(
        database,
        "SELECT private.publish_company_payout_report(%(payload)s)",
        payload,
        expected_id=report_id,
    )


def load_company_payout_report(
    database: DatabaseConnection, report_id: str
) -> CompanyPayoutReport | None:
    """Read the full saved administrator header, including private input counts."""
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select id, company_id, seller_namespace, currency, start_date, end_date,
                preprocess_version, dataset_key, marketplace_names, report_name,
                change_reason, calculation_version, component_count, settlement_version_count,
                data_kiosk_version_count, terms_version_count,
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
            select id, report_id, row_number, source, source_row_id, source_version_id,
                source_identity_id, seller_sku_id, terms_version_id, fee_period_id,
                sku, marketplace_name, activity_date, component_type, source_amount,
                quantity, fee_base, fee_rate_percent, fee_amount, company_amount,
                resolution_status
            from public.company_payout_report_components
            where report_id = %(id)s::uuid order by row_number
            """,
            {"id": normalize_uuid(report_id, "report_id")},
        )
        return tuple(_component(row) for row in cursor.fetchall())


def _report(row: Sequence[object]) -> CompanyPayoutReport:
    if len(row) != 20:
        raise RuntimeError("The payout report query returned an invalid shape.")
    created_at = row[19]
    if not isinstance(created_at, datetime) or created_at.utcoffset() is None:
        raise RuntimeError("created_at must be a timezone-aware datetime.")
    return CompanyPayoutReport(
        id=normalize_uuid(row[0], "id"),
        company_id=normalize_uuid(row[1], "company_id"),
        seller_namespace=validate_seller_namespace(required_text(row[2], "seller_namespace")),
        currency=financial_currency(row[3]),
        start_date=required_date(row[4], "start_date"),
        end_date=required_date(row[5], "end_date"),
        preprocess_version=required_text(row[6], "preprocess_version"),
        dataset_key=required_text(row[7], "dataset_key"),
        marketplace_names=_marketplaces(row[8]),
        report_name=required_text(row[9], "report_name"),
        change_reason=required_text(row[10], "change_reason"),
        calculation_version=required_text(row[11], "calculation_version"),
        component_count=nonnegative_count(row[12], "component_count"),
        settlement_version_count=nonnegative_count(row[13], "settlement_version_count"),
        data_kiosk_version_count=nonnegative_count(row[14], "data_kiosk_version_count"),
        terms_version_count=nonnegative_count(row[15], "terms_version_count"),
        source_amount=financial_amount(row[16], "source_amount"),
        fee_amount=financial_amount(row[17], "fee_amount"),
        company_amount=financial_amount(row[18], "company_amount"),
        created_at=created_at,
    )


def _component(row: Sequence[object]) -> CompanyPayoutComponent:
    if len(row) != 21:
        raise RuntimeError("The payout component query returned an invalid shape.")
    source = required_text(row[3], "source")
    status = required_text(row[20], "resolution_status")
    if source not in ("SETTLEMENT", "DATA_KIOSK") or status not in ("APPLIED", "NOT_APPLICABLE"):
        raise RuntimeError("Payout components must have a known source and resolved amounts.")
    sku = row[10]
    if not isinstance(sku, str) or not sku.strip():
        raise RuntimeError("sku must be nonblank source text.")
    return CompanyPayoutComponent(
        id=normalize_uuid(row[0], "id"),
        report_id=normalize_uuid(row[1], "report_id"),
        row_number=nonnegative_count(row[2], "row_number"),
        source=source,
        source_row_id=normalize_uuid(row[4], "source_row_id"),
        source_version_id=normalize_uuid(row[5], "source_version_id"),
        source_identity_id=normalize_uuid(row[6], "source_identity_id"),
        seller_sku_id=normalize_uuid(row[7], "seller_sku_id"),
        terms_version_id=normalize_uuid(row[8], "terms_version_id"),
        fee_period_id=None if row[9] is None else normalize_uuid(row[9], "fee_period_id"),
        sku=sku,
        marketplace_name=(
            None
            if row[11] is None
            else validate_marketplace_name(required_text(row[11], "marketplace_name"))
        ),
        activity_date=required_date(row[12], "activity_date"),
        component_type=required_text(row[13], "component_type"),
        source_amount=financial_amount(row[14], "source_amount"),
        quantity=optional_financial_amount(row[15], "quantity"),
        fee_base=optional_financial_amount(row[16], "fee_base"),
        fee_rate_percent=optional_financial_amount(row[17], "fee_rate_percent"),
        fee_amount=financial_amount(row[18], "fee_amount"),
        company_amount=financial_amount(row[19], "company_amount"),
        resolution_status=status,
    )


def _marketplaces(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise RuntimeError("marketplace_names must be an array.")
    return tuple(
        validate_marketplace_name(required_text(item, "marketplace_name"))
        for item in cast(list[object], value)
    )
