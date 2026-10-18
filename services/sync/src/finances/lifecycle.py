"""Validate native original/release links without treating status as a deduplication key."""

from collections.abc import Mapping

from .values import account_type, money, object_value, related_ids, text


def release_transaction_ids(rows: Mapping[str, Mapping[str, object]]) -> set[str]:
    """Return linked releases, including reverse-only links and out-of-window originals."""
    original_to_release: dict[str, str] = {}
    release_to_original: dict[str, str] = {}
    for identifier, row in rows.items():
        links = related_ids(row.get("relatedIdentifiers"))
        original = links.get("DEFERRED_TRANSACTION_ID")
        released = links.get("RELEASE_TRANSACTION_ID")
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
        if target.get("transactionStatus") != "RELEASED":
            raise ValueError("Linked Finances release must have RELEASED status.")
        if _identity(source) != _identity(target):
            raise ValueError("Linked Finances transactions disagree on their financial scope.")
    return set(release_to_original)


def _identity(row: Mapping[str, object]) -> tuple[object, ...]:
    metadata = object_value(row.get("sellingPartnerMetadata"))
    return (
        text(metadata.get("sellingPartnerId")),
        text(metadata.get("marketplaceId")),
        account_type(metadata.get("accountType")),
        text(row.get("transactionType")),
        money(row.get("totalAmount")),
    )
