"""Publish immutable company/SKU fee versions and resolve current rules."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from ..amazon.identifiers import validate_marketplace_id
from ..numeric import ZERO, Numeric
from .connection import DatabaseConnection
from .fee_reference_checks import check_settlement_fee_references
from .seller_namespaces import validate_seller_namespace
from .values import date_value, normalize_uuid, numeric_value, required_text

_MAX_FEE_RATE_PERCENT = Numeric(100)


class UnassignedSelboxFeeError(ValueError):
    """A processing input has no current fee covering its activity interval."""


LOAD_COMPANY_SKU_FEE_RATES_SQL = """
    with requested_key as (
        select distinct
            requested.marketplace_id,
            requested.sku
        from unnest(
            %(marketplace_ids)s::varchar[],
            %(skus)s::varchar[]
        ) as requested (marketplace_id, sku)
    )
    select
        fee_rate.id::text,
        fee_rate.seller_namespace,
        fee_rate.marketplace_id,
        fee_rate.sku,
        fee_rate.company_id::text,
        fee_rate.fee_rate_percent,
        lower(fee_rate.valid_period),
        upper(fee_rate.valid_period)
    from requested_key
    inner join private.latest_company_sku_fee_rates as fee_rate
      on fee_rate.seller_namespace = %(seller_namespace)s
     and fee_rate.marketplace_id = requested_key.marketplace_id
     and fee_rate.sku = requested_key.sku
     and fee_rate.valid_period && daterange(
         %(activity_date_from)s::date,
         %(activity_date_to)s::date,
         '[]'
     )
    order by
        fee_rate.marketplace_id,
        fee_rate.sku,
        lower(fee_rate.valid_period),
        fee_rate.id
"""


class FeeRateCursor(Protocol):
    """Cursor operations used by the fee-rate loader."""

    def execute(self, query: str, parameters: dict[str, object], /) -> object: ...

    def fetchall(self) -> Sequence[Sequence[object]]: ...


def insert_company_sku_fee_rate(
    database: DatabaseConnection,
    fee_rate: CompanySkuFeeRate,
) -> str:
    """Commit a new fee version, then advise which Settlement reports to rerun."""
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor() as cursor,
    ):
        cursor.execute(
            """
            insert into public.company_sku_fee_rates (
                id, seller_namespace, marketplace_id, sku, company_id,
                fee_rate_percent, valid_period
            ) values (
                %(id)s::uuid, %(seller_namespace)s, %(marketplace_id)s, %(sku)s,
                %(company_id)s::uuid, %(fee_rate_percent)s,
                daterange(%(valid_from)s::date, %(valid_to)s::date, '[)')
            )
            """,
            {
                "id": fee_rate.id,
                "seller_namespace": fee_rate.seller_namespace,
                "marketplace_id": fee_rate.marketplace_id,
                "sku": fee_rate.sku,
                "company_id": fee_rate.company_id,
                "fee_rate_percent": fee_rate.fee_rate_percent.value,
                "valid_from": fee_rate.valid_from,
                "valid_to": fee_rate.valid_to,
            },
        )
    check_settlement_fee_references(database, fee_rate_id=fee_rate.id)
    return fee_rate.id


@dataclass(frozen=True, slots=True)
class CompanySkuFeeRate:
    """One effective-dated company ownership and fee-rate rule."""

    id: str
    seller_namespace: str
    marketplace_id: str
    sku: str
    company_id: str
    fee_rate_percent: Numeric
    valid_from: date
    valid_to: date | None

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", normalize_uuid(self.id, "company_sku_fee_rate_id"))
        object.__setattr__(
            self,
            "seller_namespace",
            validate_seller_namespace(self.seller_namespace),
        )
        object.__setattr__(self, "marketplace_id", validate_marketplace_id(self.marketplace_id))
        object.__setattr__(self, "sku", required_text(self.sku, "sku"))
        object.__setattr__(self, "company_id", normalize_uuid(self.company_id, "company_id"))
        if (
            type(self.fee_rate_percent) is not Numeric
            or not ZERO <= self.fee_rate_percent <= _MAX_FEE_RATE_PERCENT
        ):
            raise ValueError("fee_rate_percent must be between zero and 100.")
        if self.valid_to is not None and self.valid_from >= self.valid_to:
            raise ValueError("Company/SKU fee-rate periods must be non-empty [) ranges.")

    def applies_on(self, activity_date: date) -> bool:
        """Return whether this rule covers one activity date."""
        return self.valid_from <= activity_date and (
            self.valid_to is None or activity_date < self.valid_to
        )


class CompanySkuFeeRateResolver:
    """Resolve at most one fee rule for each marketplace/SKU/date."""

    def __init__(self, fee_rates: Sequence[CompanySkuFeeRate]) -> None:
        self._rates_by_key: dict[tuple[str, str], list[CompanySkuFeeRate]] = {}
        for fee_rate in fee_rates:
            self._rates_by_key.setdefault((fee_rate.marketplace_id, fee_rate.sku), []).append(
                fee_rate
            )

    def resolve(
        self,
        marketplace_id: str,
        sku: str,
        activity_date: date,
    ) -> CompanySkuFeeRate | None:
        """Return the effective rule, rejecting overlapping database data."""
        match = None
        for fee_rate in self._rates_by_key.get((marketplace_id, sku), ()):
            if fee_rate.applies_on(activity_date):
                if match is not None:
                    raise ValueError("Multiple company/SKU fee rates cover the same activity date.")
                match = fee_rate
        return match


def calculate_selbox_fee(
    fee_base: Numeric,
    fee_rate_percent: Numeric | None,
) -> Numeric:
    """Calculate an exact signed Selbox fee from percentage points."""
    if fee_rate_percent is None or not fee_base or not fee_rate_percent:
        return ZERO
    return -(fee_base * fee_rate_percent * Numeric("0.01"))


def load_company_sku_fee_rates(
    cursor: FeeRateCursor,
    *,
    seller_namespace: str,
    marketplace_skus: Sequence[tuple[str, str]],
    activity_date_from: date,
    activity_date_to: date,
) -> tuple[CompanySkuFeeRate, ...]:
    """Load candidate rules for exact keys and one inclusive activity-date window."""
    seller = validate_seller_namespace(seller_namespace)
    if activity_date_from > activity_date_to:
        raise ValueError("Fee-rate activity-date window must not be inverted.")
    keys = tuple(
        sorted(
            {
                (validate_marketplace_id(marketplace_id), required_text(sku, "sku"))
                for marketplace_id, sku in marketplace_skus
            }
        )
    )
    if not keys:
        return ()
    cursor.execute(
        LOAD_COMPANY_SKU_FEE_RATES_SQL,
        {
            "seller_namespace": seller,
            "marketplace_ids": [key[0] for key in keys],
            "skus": [key[1] for key in keys],
            "activity_date_from": activity_date_from,
            "activity_date_to": activity_date_to,
        },
    )
    return tuple(_fee_rate_from_row(row) for row in cursor.fetchall())


def _fee_rate_from_row(row: Sequence[object]) -> CompanySkuFeeRate:
    if len(row) != 8:
        raise RuntimeError("Company/SKU fee-rate query returned an unexpected shape.")
    return CompanySkuFeeRate(
        id=normalize_uuid(row[0], "company_sku_fee_rate_id"),
        seller_namespace=required_text(row[1], "seller_namespace"),
        marketplace_id=required_text(row[2], "marketplace_id"),
        sku=required_text(row[3], "sku"),
        company_id=normalize_uuid(row[4], "company_id"),
        fee_rate_percent=numeric_value(row[5], "fee_rate_percent"),
        valid_from=date_value(row[6], "valid_from"),
        valid_to=None if row[7] is None else date_value(row[7], "valid_to"),
    )


__all__ = [
    "LOAD_COMPANY_SKU_FEE_RATES_SQL",
    "CompanySkuFeeRate",
    "CompanySkuFeeRateResolver",
    "FeeRateCursor",
    "UnassignedSelboxFeeError",
    "calculate_selbox_fee",
    "insert_company_sku_fee_rate",
    "load_company_sku_fee_rates",
]
