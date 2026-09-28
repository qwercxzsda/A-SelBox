"""Read complete live company totals through the shared privileged SQL boundary."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import cast

from .connection import DatabaseConnection
from .financial_scope import financial_scope_parameters
from .financial_values import (
    financial_amount,
    financial_currency,
    nonnegative_count,
    optional_financial_amount,
)
from .values import normalize_uuid, required_text


@dataclass(frozen=True, slots=True)
class CompanyFinancialTotal:
    """Exact totals for one company and currency in a fully validated scope."""

    company_id: str
    currency: str
    source_amount: Decimal
    fee_amount: Decimal
    company_amount: Decimal


@dataclass(frozen=True, slots=True)
class MissingFeeComponent:
    """The exact source component omitted from calculated partial amounts."""

    source: str
    source_row_id: str
    source_version_id: str
    source_identity_id: str
    seller_namespace: str
    sku: str
    marketplace_name: str
    activity_date: date
    currency: str
    source_amount: Decimal
    fee_base: Decimal
    sku_id: str
    terms_version_id: str
    resolution_status: str


@dataclass(frozen=True, slots=True)
class CompanyFinancialProgress:
    """Known component sums plus exact missing-fee details from one database read."""

    company_id: str
    currency: str
    source_amount: Decimal
    known_fee_amount: Decimal | None
    known_company_amount: Decimal | None
    missing_fee_count: int
    missing_fee_components: tuple[MissingFeeComponent, ...]

    @property
    def has_missing_fees(self) -> bool:
        """Indicate whether the calculated sums omit fee-bearing components."""
        return self.missing_fee_count > 0


def load_company_financial_totals(
    database: DatabaseConnection,
    *,
    seller_namespace: str,
    start_date: date,
    end_date: date,
    preprocess_version: str,
    settlement_ids: Sequence[str],
    marketplace_names: Sequence[str],
    dataset_key: str = "economics",
) -> tuple[CompanyFinancialTotal, ...]:
    """Validate declared settlement inputs and inclusive Data Kiosk day coverage.

    This administrator read sees unmapped SKUs as well as mapped companies.
    Missing/mixed source versions, ownership and required fees raise in SQL;
    they cannot silently disappear through null aggregation or tenant policies.
    """
    parameters = financial_scope_parameters(
        seller_namespace=seller_namespace,
        start_date=start_date,
        end_date=end_date,
        preprocess_version=preprocess_version,
        settlement_ids=settlement_ids,
        marketplace_names=marketplace_names,
        dataset_key=dataset_key,
    )
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select company_id, currency, source_amount, fee_amount, company_amount
            from private.company_financial_totals(
                %(seller_namespace)s, %(start_date)s::date, %(end_date)s::date,
                %(preprocess_version)s, %(settlement_ids)s::uuid[],
                %(marketplace_names)s::text[], %(dataset_key)s
            ) order by company_id, currency
            """,
            parameters,
        )
        return tuple(_financial_total(row) for row in cursor.fetchall())


def _financial_total(row: Sequence[object]) -> CompanyFinancialTotal:
    if len(row) != 5:
        raise RuntimeError("The company financial total query returned an invalid shape.")
    return CompanyFinancialTotal(
        company_id=normalize_uuid(row[0], "company_id"),
        currency=financial_currency(row[1]),
        source_amount=financial_amount(row[2], "source_amount"),
        fee_amount=financial_amount(row[3], "fee_amount"),
        company_amount=financial_amount(row[4], "company_amount"),
    )


def load_company_financial_progress(
    database: DatabaseConnection,
    *,
    seller_namespace: str,
    start_date: date,
    end_date: date,
    preprocess_version: str,
    settlement_ids: Sequence[str],
    marketplace_names: Sequence[str],
    dataset_key: str = "economics",
) -> tuple[CompanyFinancialProgress, ...]:
    """Allow missing fees while retaining strict source and ownership validation.

    Known company amounts sum resolved components, not the full source amount
    plus the known fees. An all-unresolved group retains NULL calculated sums.
    """
    parameters = financial_scope_parameters(
        seller_namespace=seller_namespace,
        start_date=start_date,
        end_date=end_date,
        preprocess_version=preprocess_version,
        settlement_ids=settlement_ids,
        marketplace_names=marketplace_names,
        dataset_key=dataset_key,
    )
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select company_id, currency, source_amount, known_fee_amount,
                known_company_amount, missing_fee_count, missing_fee_components
            from private.company_financial_progress(
                %(seller_namespace)s, %(start_date)s::date, %(end_date)s::date,
                %(preprocess_version)s, %(settlement_ids)s::uuid[],
                %(marketplace_names)s::text[], %(dataset_key)s
            ) order by company_id, currency
            """,
            parameters,
        )
        return tuple(_financial_progress(row) for row in cursor.fetchall())


def _financial_progress(row: Sequence[object]) -> CompanyFinancialProgress:
    if len(row) != 7 or not isinstance(row[6], list):
        raise RuntimeError("The financial progress query returned an invalid shape.")
    components = tuple(_missing_fee_component(item) for item in cast(list[object], row[6]))
    count = nonnegative_count(row[5], "missing_fee_count")
    if len(components) != count:
        raise RuntimeError("Missing-fee detail does not match the component count.")
    return CompanyFinancialProgress(
        company_id=normalize_uuid(row[0], "company_id"),
        currency=financial_currency(row[1]),
        source_amount=financial_amount(row[2], "source_amount"),
        known_fee_amount=optional_financial_amount(row[3], "known_fee_amount"),
        known_company_amount=optional_financial_amount(row[4], "known_company_amount"),
        missing_fee_count=count,
        missing_fee_components=components,
    )


def _missing_fee_component(value: object) -> MissingFeeComponent:
    if not isinstance(value, Mapping):
        raise RuntimeError("Missing-fee detail must be an object.")
    fields = cast(Mapping[str, object], value)
    status = required_text(fields.get("resolution_status"), "resolution_status")
    source = required_text(fields.get("source"), "source")
    sku = fields.get("sku")
    if status != "MISSING_FEE" or source not in ("SETTLEMENT", "DATA_KIOSK"):
        raise RuntimeError("Missing-fee detail has an invalid status or source.")
    if not isinstance(sku, str) or not sku.strip():
        raise RuntimeError("sku must be nonblank source text.")
    return MissingFeeComponent(
        source=source,
        source_row_id=normalize_uuid(fields.get("source_row_id"), "source_row_id"),
        source_version_id=normalize_uuid(fields.get("source_version_id"), "source_version_id"),
        source_identity_id=normalize_uuid(fields.get("source_identity_id"), "source_identity_id"),
        seller_namespace=required_text(fields.get("seller_namespace"), "seller_namespace"),
        sku=sku,
        marketplace_name=required_text(fields.get("marketplace_name"), "marketplace_name"),
        activity_date=date.fromisoformat(
            required_text(fields.get("activity_date"), "activity_date")
        ),
        currency=financial_currency(fields.get("currency")),
        source_amount=_json_amount(fields.get("source_amount"), "source_amount"),
        fee_base=_json_amount(fields.get("fee_base"), "fee_base"),
        sku_id=normalize_uuid(fields.get("sku_id"), "sku_id"),
        terms_version_id=normalize_uuid(fields.get("terms_version_id"), "terms_version_id"),
        resolution_status=status,
    )


def _json_amount(value: object, name: str) -> Decimal:
    if not isinstance(value, str):
        raise RuntimeError(f"{name} must be exact decimal text in JSON details.")
    return financial_amount(Decimal(value), name)
