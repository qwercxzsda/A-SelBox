"""Validate native original/release links without treating status as a deduplication key."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ..numeric import Numeric
from .values import account_type, money, object_value, related_ids, text

if TYPE_CHECKING:
    from .models import FinancesTransaction


@dataclass(frozen=True, slots=True)
class TransactionLifecycle:
    """The same lifecycle facts from an archived record or an accepted transaction."""

    seller: str
    marketplace: str
    account: str
    kind: str
    status: str
    amount: Numeric
    currency: str
    original: str | None
    released: str | None

    @classmethod
    def from_native(cls, row: Mapping[str, object]) -> TransactionLifecycle:
        metadata = object_value(row.get("sellingPartnerMetadata"))
        links = related_ids(row.get("relatedIdentifiers"))
        amount, currency = money(row.get("totalAmount"))
        return cls(
            text(metadata.get("sellingPartnerId")),
            text(metadata.get("marketplaceId")),
            account_type(metadata.get("accountType")),
            text(row.get("transactionType")),
            text(row.get("transactionStatus")),
            amount,
            currency,
            links.get("DEFERRED_TRANSACTION_ID"),
            links.get("RELEASE_TRANSACTION_ID"),
        )

    @classmethod
    def from_transaction(cls, row: FinancesTransaction, seller: str) -> TransactionLifecycle:
        return cls(
            seller,
            row.marketplace_id,
            row.account_type,
            row.transaction_type,
            row.transaction_status,
            row.total_amount,
            row.currency,
            row.deferred_transaction_id,
            row.release_transaction_id,
        )

    @classmethod
    def from_stored(cls, row: Mapping[str, object], seller: str) -> TransactionLifecycle:
        return cls(
            seller,
            text(row["marketplace_id"]),
            account_type(row["account_type"]),
            text(row["transaction_type"]),
            text(row["transaction_status"]),
            Numeric(row["total_amount"]),
            text(row["currency"]),
            None
            if row["deferred_transaction_id"] is None
            else text(row["deferred_transaction_id"]),
            None if row["release_transaction_id"] is None else text(row["release_transaction_id"]),
        )

    @property
    def financial_identity(self) -> tuple[str, str, str, str, Numeric, str]:
        return self.seller, self.marketplace, self.account, self.kind, self.amount, self.currency

    def is_activity(self, identifier: str, linked_releases: set[str]) -> bool:
        return (
            self.kind != "Transfer" and self.original is None and identifier not in linked_releases
        )


def release_transaction_ids(rows: Mapping[str, TransactionLifecycle]) -> set[str]:
    """Return linked releases, including reverse-only links and out-of-window originals."""
    original_to_release: dict[str, str] = {}
    release_to_original: dict[str, str] = {}
    for identifier, row in rows.items():
        original, released = row.original, row.released
        if original and released:
            raise ValueError("Conflicting Finances lifecycle state.")
        if original:
            source, target = original, identifier
        elif released:
            source, target = identifier, released
        else:
            continue
        if source == target:
            raise ValueError("Finances lifecycle cannot refer to itself.")
        if original_to_release.setdefault(source, target) != target or (
            release_to_original.setdefault(target, source) != source
        ):
            raise ValueError("Conflicting Finances original/release links.")
    if original_to_release.keys() & release_to_original.keys():
        raise ValueError("Finances lifecycle cannot form a chain or cycle.")
    for original, released in original_to_release.items():
        if original not in rows or released not in rows:
            continue
        source, target = rows[original], rows[released]
        if target.status != "RELEASED":
            raise ValueError("Linked Finances release must have RELEASED status.")
        if source.financial_identity != target.financial_identity:
            raise ValueError("Linked Finances transactions disagree on their financial scope.")
    return set(release_to_original)
