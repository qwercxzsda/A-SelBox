"""Publish complete immutable company and marketplace fee terms for a seller/SKU."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from itertools import pairwise
from uuid import uuid7

from ..amazon.marketplace_names import validate_marketplace_name
from ..numeric import Numeric
from .connection import DatabaseConnection
from .publication import publish_json
from .seller_namespaces import validate_seller_namespace
from .values import normalize_uuid, required_date, required_text


@dataclass(frozen=True, slots=True)
class FeePeriod:
    """One marketplace and half-open effective period in complete SKU terms."""

    marketplace_name: str
    valid_from: date
    valid_to: date | None
    fee_rate_percent: Numeric

    def __post_init__(self) -> None:
        validate_marketplace_name(self.marketplace_name)
        required_date(self.valid_from, "valid_from")
        if self.valid_to is not None:
            required_date(self.valid_to, "valid_to")
            if self.valid_to <= self.valid_from:
                raise ValueError("Fee periods must be nonempty [start, end) ranges.")
        rate = self.fee_rate_percent
        if type(rate) is not Numeric or not 0 <= rate <= 100:
            raise ValueError("fee_rate_percent must be a finite Numeric between 0 and 100.")
        if int(rate.value.as_tuple().exponent) < -6:
            raise ValueError("fee_rate_percent must have at most six fractional digits.")


def create_company(database: DatabaseConnection, name: str) -> str:
    """Create a company with a generated UUIDv7 identity."""
    company_id = str(uuid7())
    with (
        database.connection() as connection,
        connection.transaction(),
        connection.cursor() as cursor,
    ):
        cursor.execute(
            "insert into public.companies (id, name) values (%(id)s::uuid, %(name)s)",
            {"id": company_id, "name": required_text(name, "name")},
        )
    return company_id


def publish_sku_terms(
    database: DatabaseConnection,
    *,
    seller_namespace: str,
    sku: str,
    company_id: str | None,
    expected_current_version_id: str | None,
    periods: Sequence[FeePeriod],
    change_reason: str,
) -> str:
    """Atomically publish one complete owner and all-marketplace fee revision.

    Explicit NULL company means unassigned; empty periods mean absent fee coverage.
    Stale edits fail without retrying over newer terms. Exact SKU text is preserved.
    """
    if type(sku) is not str or not sku.strip():
        raise ValueError("sku must be nonblank source text.")
    complete_periods = tuple(sorted(periods, key=lambda p: (p.marketplace_name, p.valid_from)))
    for previous, following in pairwise(complete_periods):
        if previous.marketplace_name == following.marketplace_name and (
            previous.valid_to is None or previous.valid_to > following.valid_from
        ):
            raise ValueError("Fee periods must not overlap within a marketplace and revision.")
    version_id = str(uuid7())
    payload: dict[str, object] = {
        "id": version_id,
        "seller_sku_id": str(uuid7()),
        "seller_namespace": validate_seller_namespace(seller_namespace),
        "sku": sku,
        "company_id": normalize_uuid(company_id, "company_id") if company_id is not None else None,
        "expected_current_version_id": (
            normalize_uuid(expected_current_version_id, "expected_current_version_id")
            if expected_current_version_id is not None
            else None
        ),
        "change_reason": required_text(change_reason, "change_reason"),
        "periods": [
            {
                "id": str(uuid7()),
                "marketplace_name": period.marketplace_name,
                "valid_from": period.valid_from.isoformat(),
                "valid_to": period.valid_to.isoformat() if period.valid_to is not None else None,
                "fee_rate_percent": str(period.fee_rate_percent),
            }
            for period in complete_periods
        ],
    }
    return publish_json(
        database,
        "SELECT private.publish_sku_terms(%(payload)s)",
        payload,
        expected_id=version_id,
    )
