"""Validate a complete proposed observation against accepted native transactions."""

from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import UTC, date
from typing import Any

from ..allocation import AllocationCategory
from ..numeric import ZERO, Numeric
from ..source_serialization import content_sha256, source_mapping
from .acquisition_models import FinancesAcquisition
from .lifecycle import TransactionLifecycle, release_transaction_ids
from .marketplaces import financial_marketplace_name, financial_marketplace_timezone
from .models import FinancesComponent, FinancesSummary, FinancesTransaction, PreparedFinances

_SUMMARY_MARKETPLACES = {
    "Non-Amazon US": "Amazon.com",
    "Non-Amazon DE": "Amazon.de",
    "Non-Amazon IT": "Amazon.it",
}


def revision_payload(transaction: FinancesTransaction) -> dict[str, object]:
    """Only immutable stored state participates; observation locations never do."""
    return {
        "marketplace_id": transaction.marketplace_id,
        "marketplace_name": transaction.marketplace_name,
        "posted_date": transaction.posted_date.isoformat(),
        "posted_at": transaction.posted_at.astimezone(UTC).isoformat(),
        "account_type": transaction.account_type,
        "transaction_type": transaction.transaction_type,
        "transaction_status": transaction.transaction_status,
        "currency": transaction.currency,
        "total_amount": _decimal(transaction.total_amount),
        "deferred_transaction_id": transaction.deferred_transaction_id,
        "release_transaction_id": transaction.release_transaction_id,
        "activity_eligible": transaction.activity_eligible,
        "components": [
            {
                **source_mapping(component),
                "amount": _decimal(component.amount),
                "quantity": _decimal(component.quantity),
                "fee_base": _decimal(component.fee_base),
            }
            for component in transaction.components
        ],
    }


def revision_digest(transaction: FinancesTransaction) -> str:
    return content_sha256(revision_payload(transaction))


def _decimal(value: Numeric | None) -> str | None:
    if value is None:
        return None
    result = format(value.value, "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    return "0" if value == ZERO else result


def validate_finances_candidate(
    acquisition: FinancesAcquisition,
    prepared: PreparedFinances,
    accepted: Sequence[Mapping[str, Any]],
    observations: Sequence[Mapping[str, Any]],
) -> PreparedFinances:
    """Return the validated candidate, including eligibility from all accepted links."""
    capture_order = (acquisition.capture_started_at, str(acquisition.id))
    if any((row["capture_started_at"], str(row["id"])) > capture_order for row in observations):
        raise ValueError("An older Finances capture cannot replace newer accepted coverage.")
    incoming = {row.native_transaction_id: row for row in prepared.transactions}
    if len(incoming) != len(prepared.transactions):
        raise ValueError("Finances native transaction identities must be unique within a run.")
    current = {str(row["native_transaction_id"]): row for row in accepted}
    for identifier, row in current.items():
        if (
            _covered(acquisition, row["marketplace_id"], row["posted_date"])
            and identifier not in incoming
        ):
            raise ValueError(
                "A previously accepted Finances transaction is missing from complete coverage."
            )
        if (
            identifier in incoming
            and (row["capture_started_at"], str(row["acquisition_id"])) > capture_order
        ):
            raise ValueError("An older Finances capture cannot replace a newer transaction.")
    pages = {page.page_number for page in acquisition.documents if page.operation == "transactions"}
    for transaction in prepared.transactions:
        _validate_transaction(acquisition, transaction, pages)
    candidate = {
        identifier: TransactionLifecycle.from_stored(row, acquisition.seller_namespace)
        for identifier, row in current.items()
    }
    candidate.update(
        {
            identifier: TransactionLifecycle.from_transaction(row, acquisition.seller_namespace)
            for identifier, row in incoming.items()
        }
    )
    releases = release_transaction_ids(candidate)
    normalized: list[FinancesTransaction] = []
    for identifier, row in candidate.items():
        eligible = row.is_activity(identifier, releases)
        if identifier in incoming:
            normalized.append(replace(incoming[identifier], activity_eligible=eligible))
        elif current[identifier]["activity_eligible"] != eligible:
            raise ValueError(
                "Finances lifecycle change requires its affected transactions in one capture."
            )
    result = PreparedFinances(
        tuple(sorted(normalized, key=lambda row: row.native_transaction_id)), prepared.summaries
    )
    _validate_summary(acquisition, result)
    return result


def _covered(acquisition: FinancesAcquisition, marketplace: str, day: date) -> bool:
    return (
        marketplace in acquisition.marketplace_ids
        and acquisition.query_start_date <= day <= acquisition.query_end_date
    )


def _validate_transaction(
    acquisition: FinancesAcquisition, transaction: FinancesTransaction, pages: set[int]
) -> None:
    if not _covered(acquisition, transaction.marketplace_id, transaction.posted_date):
        raise ValueError("Finances transaction is outside declared complete coverage.")
    if transaction.marketplace_name != financial_marketplace_name(transaction.marketplace_id):
        raise ValueError("Finances transaction has inconsistent marketplace metadata.")
    if (
        transaction.posted_date
        != transaction.posted_at.astimezone(
            financial_marketplace_timezone(transaction.marketplace_id)
        ).date()
    ):
        raise ValueError("Finances transaction local posting date is inconsistent.")
    if transaction.transaction_status not in {"DEFERRED", "DEFERRED_RELEASED", "RELEASED"}:
        raise ValueError("Unknown Finances transaction status.")
    if (
        transaction.deferred_transaction_id is not None
        and transaction.transaction_status != "RELEASED"
    ):
        raise ValueError("Linked Finances release must have RELEASED status.")
    if (
        transaction.source_page_number not in pages
        or type(transaction.source_record_number) is not int
        or transaction.source_record_number < 1
    ):
        raise ValueError("Finances transaction requires valid archived page/record provenance.")
    for component in transaction.components:
        _validate_component(component)
    if [component.component_number for component in transaction.components] != list(
        range(1, len(transaction.components) + 1)
    ):
        raise ValueError("Finances component numbers must describe the complete ordered inventory.")
    if (
        not transaction.components
        or sum((component.amount for component in transaction.components), ZERO)
        != transaction.total_amount
    ):
        raise ValueError("Finances component partition differs from its native total.")


def _nonblank(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _validate_component(component: FinancesComponent) -> None:
    if component.category not in {
        AllocationCategory.FINANCES,
        AllocationCategory.SELBOX,
        AllocationCategory.DATA_KIOSK,
    }:
        raise ValueError("Finances components require a supported monetary allocation category.")
    if component.sku is not None and (not _nonblank(component.sku)):
        raise ValueError("Finances source SKU must be nonblank when supplied.")
    if component.category is AllocationCategory.FINANCES and component.sku is None:
        raise ValueError("Allocated Finances component lacks a source SKU.")
    if not _nonblank(component.component_type):
        raise ValueError("Finances component type must be nonblank.")
    if component.accounting_subtype not in {
        None,
        "OPERATING_EXPENSE",
        "BALANCE_MOVEMENT",
        "TAX_RECLASSIFICATION",
    }:
        raise ValueError("Unsupported Finances accounting subtype.")
    if (
        type(component.component_number) is not int
        or component.component_number < 1
        or type(component.item_index) is not int
        or component.item_index < 0
    ):
        raise ValueError("Finances component/item positions are invalid.")
    if (
        len(component.breakdown_path) != len(component.breakdown_indexes)
        or any(not _nonblank(part) for part in component.breakdown_path)
        or any(type(index) is not int or index < 0 for index in component.breakdown_indexes)
    ):
        raise ValueError("Finances breakdown path and indexes must identify the same source leaf.")
    if component.quantity is not None and component.quantity < ZERO:
        raise ValueError("Finances shipped quantity must be nonnegative.")
    if component.component_type in {"PRODUCT_SALES", "PRODUCT_REFUNDS"}:
        if component.fee_base != component.amount:
            raise ValueError("Finances product fee base must equal its signed source amount.")
    elif component.fee_base is not None or component.quantity is not None:
        raise ValueError(
            "Only Finances product sales/refunds carry a fee base or shipment quantity."
        )


def _summary_marketplace(name: str) -> str:
    """Group verified Summary controls without changing native transaction scope."""
    return _SUMMARY_MARKETPLACES.get(name, name)


def _validate_summary(acquisition: FinancesAcquisition, prepared: PreparedFinances) -> None:
    if acquisition.api_metadata["summary_available"] is not True:
        raise ValueError("Successful Finances preprocessing requires available Summary controls.")
    controls: dict[tuple[str, str, str], FinancesSummary] = {}
    for summary in prepared.summaries:
        if (summary.period_start, summary.period_end) != (
            acquisition.query_start_date,
            acquisition.query_end_date,
        ):
            raise ValueError("Finances Summary does not cover the complete capture period.")
        key = (
            _summary_marketplace(summary.marketplace_name),
            summary.account_type,
            summary.currency,
        )
        if key in controls:
            raise ValueError("Finances Summary repeats an account/currency scope.")
        controls[key] = summary
    expected_markets = {
        _summary_marketplace(market.marketplace_name)
        for market in acquisition.coverage_marketplaces
    }
    if expected_markets - {key[0] for key in controls}:
        raise ValueError(
            "Finances Summary is missing a covered marketplace, including zero-activity coverage."
        )
    totals: dict[tuple[str, str, str], Numeric] = {}
    for transaction in prepared.transactions:
        key = (
            _summary_marketplace(transaction.marketplace_name),
            transaction.account_type,
            transaction.currency,
        )
        if key not in controls:
            raise ValueError("Finances Summary is missing a native account/currency scope.")
        if transaction.activity_eligible:
            totals[key] = totals.get(key, ZERO) + transaction.total_amount
    for key, summary in controls.items():
        if totals.get(key, ZERO) != summary.net_proceeds:
            raise ValueError(
                "Finances Summary does not match the complete proposed transaction state."
            )
