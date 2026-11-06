"""Typed Finance observations published through the production transaction-version workflow."""

from __future__ import annotations

from calendar import monthrange
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING, cast
from uuid import UUID
from zoneinfo import ZoneInfo

from services.db.supabase.tests.integration_support import TransactionDatabase
from services.sync.src.allocation import AllocationCategory
from services.sync.src.amazon.finances.client import FINANCES_API_VERSION, FinancesOperation
from services.sync.src.amazon.financial_channels import FINANCIAL_CHANNELS
from services.sync.src.amazon.marketplace_names import MARKETPLACE_NAME_BY_ID
from services.sync.src.amazon.marketplaces import CREDENTIAL_SCOPES
from services.sync.src.archives.serialization import document_from_payload
from services.sync.src.database.finances import publish_finances
from services.sync.src.finances.acquisition_models import (
    ArchivedFinancesPage,
    FinancesAcquisition,
    FinancesCoverageMarketplace,
)
from services.sync.src.finances.marketplaces import financial_marketplace_timezone
from services.sync.src.finances.models import (
    FinancesComponent,
    FinancesSummary,
    FinancesTransaction,
    PreparedFinances,
)
from services.sync.src.numeric import ZERO, Numeric
from services.sync.src.source_serialization import source_json

if TYPE_CHECKING:
    from services.db.supabase.tests.source_fixtures import SourceModelFixture


_MARKETPLACE_SCOPES = {
    MARKETPLACE_NAME_BY_ID[identifier]: (identifier, name)
    for name, scope in CREDENTIAL_SCOPES.items()
    for identifier in scope.marketplace_ids
}
_MARKETPLACE_SCOPES.update(
    {
        channel.marketplace_name: (identifier, channel.amazon_scope)
        for identifier, channel in FINANCIAL_CHANNELS.items()
    }
)


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
    """Prepare an immutable archive manifest locally; preprocessing publishes metadata."""
    from services.db.supabase.tests.source_fixtures import archive_document, new_id

    captured_at = datetime.now(UTC)
    start_date, end_date = date.fromisoformat(start), date.fromisoformat(end)
    local_start = datetime.combine(start_date, time.min, ZoneInfo(time_zone))
    local_end = datetime.combine(end_date + timedelta(days=1), time.min, ZoneInfo(time_zone))
    identifier = new_id()
    coverage = FinancesCoverageMarketplace(marketplace_id, marketplace, time_zone)
    document = document_from_payload(archive_document(digest))
    operations: tuple[FinancesOperation, ...] = ("transactions", "summary")
    manifest = FinancesAcquisition(
        id=UUID(identifier),
        seller_namespace=self.seller,
        amazon_scope=amazon_scope,
        api_version=FINANCES_API_VERSION,
        capture_started_at=captured_at,
        downloaded_at=captured_at,
        query_start_date=start_date,
        query_end_date=end_date,
        marketplace_ids=(marketplace_id,),
        api_metadata={
            "coverage_marketplaces": [source_json(coverage)],
            "summary_available": True,
            "capture_label": capture_label,
        },
        documents=tuple(
            ArchivedFinancesPage(
                operation=operation,
                page_number=1,
                marketplace_id=None,
                is_terminal=True,
                request_parameters={
                    "postedAfter": local_start.astimezone(UTC).isoformat(),
                    "postedBefore": local_end.astimezone(UTC).isoformat(),
                }
                if operation == "transactions"
                else {"periodStart": start, "periodEnd": end},
                requested_at=captured_at,
                received_at=captured_at,
                document=document,
            )
            for operation in operations
        ),
    )
    self.finances_acquisitions[identifier] = manifest
    return identifier


def finances(
    self: SourceModelFixture,
    rows: list[dict[str, object]],
    *,
    acquisition_id: str | None = None,
    version: str = "v0",
    identity: str = "finances",
) -> tuple[str, str | None]:
    """Publish complete observations, returning a batch and representative transaction version."""
    if acquisition_id is not None:
        result = _finances_capture(self, rows, acquisition_id=acquisition_id, version=version)
        self.last_finances_batch_ids = [result[0]]
        return result
    groups = _capture_groups(rows)
    representative = next(iter(groups))
    self.last_finances_batch_ids = []
    results: dict[tuple[date, str], tuple[str, str | None]] = {}
    for (month, marketplace), selected in sorted(groups.items()):
        marketplace_id, amazon_scope = _MARKETPLACE_SCOPES[marketplace]
        capture = self.acquisition(
            capture_label=identity,
            start=month.isoformat(),
            end=month.replace(day=monthrange(month.year, month.month)[1]).isoformat(),
            marketplace=marketplace,
            marketplace_id=marketplace_id,
            time_zone=financial_marketplace_timezone(marketplace_id).key,
            amazon_scope=amazon_scope,
        )
        result = _finances_capture(self, selected, acquisition_id=capture, version=version)
        self.last_finances_batch_ids.append(result[0])
        results[month, marketplace] = result
    return results[representative]


def _capture_groups(
    rows: list[dict[str, object]],
) -> dict[tuple[date, str], list[dict[str, object]]]:
    """Group once while retaining the input's first source scope as representative."""
    groups: dict[tuple[date, str], list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        marketplace = row.get("marketplace_name")
        if not isinstance(marketplace, str):
            raise ValueError(
                "Fixture Finances transactions require their explicit native marketplace."
            )
        month = date.fromisoformat(str(row["posted_date"])).replace(day=1)
        groups[month, marketplace].append(row)
    return groups or {(date(2026, 6, 1), "Amazon.com"): []}


def _number(value: object) -> Numeric | None:
    return None if value is None else Numeric(str(value))


def _transaction(
    row: dict[str, object], capture: FinancesAcquisition, index: int
) -> FinancesTransaction:
    market = capture.coverage_marketplaces[0]
    if row.get("marketplace_name") != market.marketplace_name:
        raise ValueError("Fixture transaction marketplace differs from explicit capture scope.")
    native = str(row.setdefault("native_transaction_id", row["id"]))
    path = row.get("breakdown_path", [])
    if not isinstance(path, list | tuple):
        raise TypeError("Fixture breakdown path must be a sequence.")
    path = cast(list[object] | tuple[object, ...], path)
    component = FinancesComponent(
        component_number=1,
        category=AllocationCategory(str(row.get("category"))),
        component_type=str(row["component_type"]),
        sku=None if row.get("sku") is None else str(row["sku"]),
        amount=Numeric(str(row["amount"])),
        quantity=_number(row.get("quantity")),
        fee_base=_number(row.get("fee_base")),
        accounting_subtype=None
        if row.get("accounting_subtype") is None
        else str(row["accounting_subtype"]),
        breakdown_path=tuple(str(part) for part in path),
        item_index=0,
        breakdown_indexes=tuple(0 for _ in path),
    )
    return FinancesTransaction(
        native_transaction_id=native,
        marketplace_id=market.marketplace_id,
        marketplace_name=market.marketplace_name,
        posted_date=date.fromisoformat(str(row["posted_date"])),
        account_type=str(row.get("account_type", "STANDARD_ORDERS")),
        transaction_type=str(row["transaction_type"]),
        transaction_status=str(row.get("transaction_status", "RELEASED")),
        posted_at=datetime.fromisoformat(str(row["posted_at"])),
        currency=str(row["currency"]),
        total_amount=Numeric(str(row["amount"])),
        deferred_transaction_id=None
        if row.get("deferred_transaction_id") is None
        else str(row["deferred_transaction_id"]),
        release_transaction_id=None
        if row.get("release_transaction_id") is None
        else str(row["release_transaction_id"]),
        activity_eligible=bool(row.get("activity_eligible", True)),
        source_page_number=1,
        source_record_number=int(str(row.get("source_record_number", index))),
        components=(component,),
    )


def _summaries(
    capture: FinancesAcquisition, transactions: tuple[FinancesTransaction, ...]
) -> tuple[FinancesSummary, ...]:
    market = capture.coverage_marketplaces[0]
    summary_market = (
        "Amazon.com" if market.marketplace_name == "Non-Amazon US" else market.marketplace_name
    )
    summary_market_id = "ATVPDKIKX0DER" if summary_market == "Amazon.com" else market.marketplace_id
    scopes = {(row.account_type, row.currency) for row in transactions} or {
        ("STANDARD_ORDERS", "USD")
    }
    releases = {row.release_transaction_id for row in transactions if row.release_transaction_id}
    return tuple(
        FinancesSummary(
            marketplace_id=summary_market_id,
            marketplace_name=summary_market,
            account_type=account,
            currency=currency,
            period_start=capture.query_start_date,
            period_end=capture.query_end_date,
            net_proceeds=sum(
                (
                    row.total_amount
                    for row in transactions
                    if row.account_type == account
                    and row.currency == currency
                    and row.transaction_type != "Transfer"
                    and row.deferred_transaction_id is None
                    and row.native_transaction_id not in releases
                ),
                ZERO,
            ),
            source_page_number=1,
            source_summary_index=index,
        )
        for index, (account, currency) in enumerate(sorted(scopes), 1)
    )


def _finances_capture(
    self: SourceModelFixture,
    rows: list[dict[str, object]],
    *,
    acquisition_id: str,
    version: str,
) -> tuple[str, str | None]:
    capture = self.finances_acquisitions[acquisition_id]
    transactions = tuple(_transaction(row, capture, index) for index, row in enumerate(rows, 1))
    prepared = PreparedFinances(transactions, _summaries(capture, transactions))
    # Keep the test-owned transaction open; production publication uses a nested savepoint.
    self.connection.execute("select 1")
    batch_id = publish_finances(
        TransactionDatabase(self.connection), capture, prepared, preprocess_version=version
    )
    published = {
        str(native): (str(component), str(revision))
        for native, component, revision in self.connection.execute(
            "select native_transaction_id,id,version_id from private.finances_batch_components "
            "where batch_id=%s",
            (batch_id,),
        )
    }
    for row in rows:
        row["id"] = published[str(row["native_transaction_id"])][0]
    return batch_id, published[str(rows[0]["native_transaction_id"])][1] if rows else None
