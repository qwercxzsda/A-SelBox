"""Dependency ordering for repeatable regional sync runs."""

import logging
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import cast

from ..amazon.marketplace_names import MARKETPLACE_NAME_BY_ID
from ..amazon.marketplaces import get_credential_scope
from ..archives.storage import ArchiveStorage
from ..database.connection import DatabaseConnection
from .acquisition import ReferenceRequest, download_reference
from .periods import shift_months
from .publication import preprocess_reference
from .reports import REPORT_TYPES

_LOG = logging.getLogger(__name__)
_MARKETPLACE_IDS = {name: identifier for identifier, name in MARKETPLACE_NAME_BY_ID.items()}


def _named_requests(
    database: DatabaseConnection,
    seller: str,
    scope: str,
    source: str,
    run_start: datetime,
    ids: set[str],
) -> list[ReferenceRequest]:
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            "select marketplace_name,native_key,profile_id,campaign_aid,ad_type "
            "from private.reference_id_requests where seller_namespace=%s and amazon_scope=%s "
            "and source=%s and (case when cardinality(%s::text[])>0 then native_key=any(%s) "
            "else missing or last_referenced_at >= %s end) order by native_key",
            (seller, scope, source, sorted(ids), sorted(ids), run_start),
        )
        return [
            ReferenceRequest(
                source,
                scope,
                _MARKETPLACE_IDS[market],
                seller,
                native_id=key,
                profile_id=profile,
                campaign_aid=aid,
                ad_type=kind,
            )
            for market, key, profile, aid, kind in cursor.fetchall()
        ]


def report_requests(
    database: DatabaseConnection,
    seller: str,
    scope: str,
    start: date | None,
    end: date | None,
    today: date,
) -> Iterable[ReferenceRequest]:
    month = today.replace(day=1)
    with database.connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            "select exists (select 1 from private.source_units where source='INVENTORY_LEDGER' "
            "and seller_namespace=%s and amazon_scope=%s and current_version_id is not null)",
            (seller, scope),
        )
        (ledger_loaded,) = cursor.fetchone()
    marketplace_id = cast(str, get_credential_scope(scope).client_marketplace.marketplace_id)
    for source in REPORT_TYPES:
        if source == "REMOVAL_ORDER":
            first = start or shift_months(today, -12)
            until = (
                min(shift_months(end, 1), today + timedelta(days=1))
                if end
                else today + timedelta(days=1)
            )
        else:
            months = 19 if source == "INVENTORY_LEDGER" and not ledger_loaded else 3
            first = start or shift_months(month, -months)
            until = min(shift_months(end, 1), month) if end else month
        if first < until:
            yield ReferenceRequest(
                source, scope, marketplace_id, seller, start_date=first, end_date=until
            )


def run_sources(
    database: DatabaseConnection,
    storage: ArchiveStorage,
    directory: Path,
    seller: str,
    scope: str,
    finances: Callable[[], None],
    start: date | None,
    end: date | None,
    currency_decimals: Mapping[str, int],
    sources: set[str],
    ids: set[str],
) -> int:
    """An answer fails in isolation and its verified archive remains available."""
    run_start = datetime.now(UTC)
    if (
        (start and start.day != 1)
        or (end and (end.day != 1 or end > run_start.date()))
        or (start and end and start > end)
    ):
        raise ValueError("Expected an ordered range of calendar months ending by today.")
    failures = 0

    def process(label: str, action: Callable[[], object]) -> None:
        nonlocal failures
        try:
            action()
        except Exception as error:
            failures += 1
            _LOG.error(
                "Sync answer failed [source=%s, scope=%s, exception_type=%s].",
                label,
                scope,
                type(error).__name__,
            )

    if "FINANCES" in sources:
        process("FINANCES", finances)

    def one(request: ReferenceRequest) -> None:
        manifest = download_reference(request, storage, directory)
        _LOG.info("Archived %s answer for replay [%s].", request.source, manifest)
        preprocess_reference(database, storage, manifest, currency_decimals)

    def named(source: str) -> None:
        requests = _named_requests(database, seller, scope, source, run_start, ids)
        if ids - {req.native_id for req in requests}:
            raise ValueError("A selected ID has no stored Amazon request context in this account.")
        for req in requests:
            process(source, lambda req=req: one(req))

    if "AD_INVOICE" in sources:
        process("AD_INVOICE", lambda: named("AD_INVOICE"))

    def reports() -> None:
        for req in report_requests(database, seller, scope, start, end, run_start.date()):
            if req.source in sources:
                process(req.source, lambda req=req: one(req))

    if sources.intersection(REPORT_TYPES):
        process("REPORTS", reports)
    for source in ("CAMPAIGN", "PROMOTION", "SHIPMENT"):
        if source in sources:
            process(source, lambda source=source: named(source))
    return failures
