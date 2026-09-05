"""Build typed Settlement entries from immutable raw report rows."""

from collections.abc import Mapping

from .models import LedgerEntry, SettlementSourceLine


class UnrecognizedMarketplaceError(ValueError):
    """A named Settlement row cannot be attributed to a listed marketplace."""

    def __init__(self, source_line_number: int) -> None:
        self.source_line_number = source_line_number
        super().__init__(
            f"Settlement content row {source_line_number} has an unrecognized marketplace-name."
        )


def build_ledger_entry(
    source_line: SettlementSourceLine,
    settlement_report_id: str,
    marketplace_ids_by_name: Mapping[str, tuple[str, ...]],
    *,
    settlement_currency: str,
    ledger_entry_id: str,
    default_marketplace_id: str | None = None,
) -> LedgerEntry:
    """Build one typed ledger entry from an already-typed source line."""
    marketplace_ids = (
        marketplace_ids_by_name.get(source_line.marketplace_name, ())
        if source_line.marketplace_name is not None
        else ()
    )
    if source_line.marketplace_name is not None and not marketplace_ids:
        raise UnrecognizedMarketplaceError(source_line.source_line_number)
    if len(marketplace_ids) > 1:
        raise ValueError(
            f"Overlapping marketplace mappings for {source_line.marketplace_name!r} "
            f"on {source_line.posted_date}."
        )
    return LedgerEntry(
        id=ledger_entry_id,
        settlement_report_id=settlement_report_id,
        settlement_report_line_id=source_line.settlement_report_line_id,
        posted_date=source_line.posted_date,
        posted_at=source_line.posted_at,
        currency=settlement_currency,
        settlement_amount=source_line.settlement_amount,
        transaction_type=source_line.transaction_type,
        amount_type=source_line.amount_type,
        amount_description=source_line.amount_description,
        amazon_order_id=source_line.amazon_order_id,
        amazon_order_item_id=source_line.amazon_order_item_id,
        amazon_adjustment_id=source_line.amazon_adjustment_id,
        amazon_shipment_id=source_line.amazon_shipment_id,
        marketplace_name=source_line.marketplace_name,
        marketplace_id=marketplace_ids[0] if marketplace_ids else default_marketplace_id,
        amz_sku=source_line.amz_sku,
        quantity=source_line.quantity,
    )


__all__ = ["UnrecognizedMarketplaceError", "build_ledger_entry"]
