"""Normalize complete Finances captures from immutable response-page archives."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from ..amazon.finances.client import FinancesOperation
from ..archives.storage import ArchiveStorage, load_document_archive
from ..source_serialization import content_sha256
from .acquisition_models import FinancesAcquisition
from .components import build_components
from .lifecycle import TransactionLifecycle, release_transaction_ids
from .marketplaces import financial_marketplace_name, financial_marketplace_timezone
from .models import FinancesSummary, FinancesTransaction, PreparedFinances
from .values import (
    account_type,
    array,
    decode_page,
    money,
    object_value,
    text,
    timestamp,
)


def _period(value: object) -> date:
    return date.fromisoformat(text(value))


@dataclass(frozen=True, slots=True)
class _ArchivedRecord:
    fields: Mapping[str, object]
    page_number: int
    record_number: int


def _coverage(acquisition: FinancesAcquisition) -> dict[str, str]:
    coverage: dict[str, str] = {}
    for market in acquisition.coverage_marketplaces:
        identifier = market.marketplace_id
        name = financial_marketplace_name(identifier)
        zone = financial_marketplace_timezone(identifier)
        if market.marketplace_name != name or market.time_zone != zone.key:
            raise ValueError("Finances coverage differs from the canonical marketplace registry.")
        if acquisition.query_end_date >= acquisition.capture_started_at.astimezone(zone).date():
            raise ValueError("Finances current/future local days cannot replace complete history.")
        coverage[identifier] = name
    return coverage


def prepare_finances_acquisition(
    acquisition: FinancesAcquisition, storage: ArchiveStorage
) -> PreparedFinances:
    coverage = _coverage(acquisition)
    native, summary_records = _load_records(acquisition, storage, coverage)
    transactions = _transactions(acquisition, native, coverage)
    summaries = tuple(_summary(record, acquisition, coverage) for record in summary_records)
    keys = [
        (row.marketplace_id, row.account_type, row.currency, row.period_start, row.period_end)
        for row in summaries
    ]
    if len(set(keys)) != len(keys):
        raise ValueError("Finances Summary repeats a scope within one observation.")
    return PreparedFinances(transactions, summaries)


def _load_records(
    acquisition: FinancesAcquisition, storage: ArchiveStorage, coverage: Mapping[str, str]
) -> tuple[dict[str, _ArchivedRecord], list[_ArchivedRecord]]:
    native: dict[str, _ArchivedRecord] = {}
    summaries: list[_ArchivedRecord] = []
    previous_tokens: dict[FinancesOperation, str | None] = {"transactions": None, "summary": None}
    seller_ids: set[str] = set()
    for page in acquisition.documents:
        payload = decode_page(load_document_archive(storage, page.document))
        _validate_page_scope(acquisition, page.operation, page.request_parameters, coverage)
        if page.request_parameters.get("nextToken") != previous_tokens[page.operation]:
            raise ValueError("Finances page continuation does not match the preceding response.")
        token = payload.get("nextToken")
        if token is not None and not isinstance(token, str):
            raise TypeError("Finances continuation token must be text.")
        if page.is_terminal != (not bool(token)):
            raise ValueError("Finances page terminal declaration differs from its response.")
        previous_tokens[page.operation] = token or None
        key = "transactions" if page.operation == "transactions" else "summaries"
        if key not in payload or not isinstance(payload[key], list):
            raise ValueError("Finances response lacks its required result collection.")
        for index, value in enumerate(array(payload[key]), 1):
            row = object_value(value)
            record = _ArchivedRecord(row, page.page_number, index)
            if page.operation == "summary":
                partner = object_value(row.get("partnerMetadata")).get("partnerId")
                if partner is not None:
                    seller_ids.add(text(partner))
                summaries.append(record)
                continue
            identifier = text(row.get("transactionId"))
            metadata = object_value(row.get("sellingPartnerMetadata"))
            seller_ids.add(text(metadata.get("sellingPartnerId")))
            if identifier in native:
                if content_sha256(native[identifier].fields) != content_sha256(row):
                    raise ValueError(
                        "Conflicting Finances transaction versions within one capture."
                    )
                continue
            native[identifier] = record
    if len(seller_ids) > 1:
        raise ValueError("One Finances acquisition cannot combine different Amazon sellers.")
    return native, summaries


def _transactions(
    acquisition: FinancesAcquisition,
    native: Mapping[str, _ArchivedRecord],
    coverage: Mapping[str, str],
) -> tuple[FinancesTransaction, ...]:
    lifecycles = {
        identifier: TransactionLifecycle.from_native(record.fields)
        for identifier, record in native.items()
    }
    releases = release_transaction_ids(lifecycles)
    result: list[FinancesTransaction] = []
    for identifier, record in native.items():
        row = record.fields
        lifecycle = lifecycles[identifier]
        market = lifecycle.marketplace
        if market not in coverage:
            raise ValueError("Finances response contains a marketplace outside declared coverage.")
        posted = timestamp(row.get("postedDate"))
        local_date = posted.astimezone(financial_marketplace_timezone(market)).date()
        # Regional UTC bounds include edge hours belonging to adjacent local days.
        if not acquisition.query_start_date <= local_date <= acquisition.query_end_date:
            continue
        result.append(_transaction(record, identifier, lifecycle, releases, posted, local_date))
    included = {row.native_transaction_id: row for row in result}
    included_releases = {row.release_transaction_id for row in included.values()}
    if any(
        row.native_transaction_id in releases
        and row.deferred_transaction_id is None
        and row.native_transaction_id not in included_releases
        for row in included.values()
    ):
        raise ValueError("Reverse-only Finances release requires its original in covered days.")
    return tuple(sorted(result, key=lambda row: row.native_transaction_id))


def _validate_page_scope(
    acquisition: FinancesAcquisition,
    operation: FinancesOperation,
    params: Mapping[str, str],
    coverage: Mapping[str, str],
) -> None:
    expected = (
        {"nextToken", "postedAfter", "postedBefore"}
        if operation == "transactions"
        else {"nextToken", "periodStart", "periodEnd"}
    )
    if set(params) - expected:
        raise ValueError("Filtered Finances requests cannot establish complete capture coverage.")
    if operation == "summary":
        if (_period(params.get("periodStart")), _period(params.get("periodEnd"))) != (
            acquisition.query_start_date,
            acquisition.query_end_date,
        ):
            raise ValueError("Finances Summary dates differ from declared coverage.")
        return
    start, end = timestamp(params.get("postedAfter")), timestamp(params.get("postedBefore"))
    for market in coverage:
        zone = financial_marketplace_timezone(market)
        local_start = datetime.combine(acquisition.query_start_date, datetime.min.time(), zone)
        local_end = datetime.combine(
            acquisition.query_end_date + timedelta(days=1), datetime.min.time(), zone
        )
        if start > local_start or end < local_end:
            raise ValueError("Finances request does not cover complete local days.")
    if end <= start or end - start > timedelta(days=180):
        raise ValueError("Invalid Finances request window.")


def _transaction(
    record: _ArchivedRecord,
    identifier: str,
    lifecycle: TransactionLifecycle,
    releases: set[str],
    posted: datetime,
    local_date: date,
) -> FinancesTransaction:
    row = record.fields
    status = lifecycle.status
    if status not in {"DEFERRED", "DEFERRED_RELEASED", "RELEASED"}:
        raise ValueError("Unknown Finances transaction status.")
    original, released = lifecycle.original, lifecycle.released
    if original and status != "RELEASED":
        raise ValueError("Conflicting Finances lifecycle state.")
    return FinancesTransaction(
        identifier,
        lifecycle.marketplace,
        financial_marketplace_name(lifecycle.marketplace),
        local_date,
        lifecycle.account,
        lifecycle.kind,
        status,
        posted,
        lifecycle.currency,
        lifecycle.amount,
        original,
        released,
        lifecycle.is_activity(identifier, releases),
        record.page_number,
        record.record_number,
        build_components(row),
    )


def _summary(
    record: _ArchivedRecord,
    acquisition: FinancesAcquisition,
    coverage: Mapping[str, str],
) -> FinancesSummary:
    row = record.fields
    metadata = object_value(row.get("partnerMetadata"))
    market = text(metadata.get("marketplaceId"))
    if market not in coverage:
        raise ValueError("Finances Summary contains an undeclared marketplace.")
    start, end = _period(row.get("periodStart")), _period(row.get("periodEnd"))
    if (start, end) != (acquisition.query_start_date, acquisition.query_end_date):
        raise ValueError("Finances Summary returned a different reporting period.")
    total, currency = money(row.get("netProceeds"))
    return FinancesSummary(
        market,
        coverage[market],
        account_type(metadata.get("accountType")),
        currency,
        start,
        end,
        total,
        record.page_number,
        record.record_number,
    )
