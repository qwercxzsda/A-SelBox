"""Nonblocking source diagnostics retained alongside complete Settlement results."""

from ..preprocess_version import PREPROCESS_VERSION
from .models import SettlementHeader, SettlementTransaction


def transaction_diagnostics(
    row: SettlementTransaction,
    header: SettlementHeader,
) -> list[dict[str, object]]:
    diagnostics: list[dict[str, object]] = []
    base: dict[str, object] = {
        "source_line_number": row.source_line_number,
        "preprocess_version": PREPROCESS_VERSION,
        "amount": str(row.amount),
    }
    if row.family is None:
        diagnostics.append(
            {
                **base,
                "kind": "UNMATCHED_SETTLEMENT_FAMILY",
                "sku": row.sku,
                "component_type": row.component_type,
            }
        )
    if not header.settlement_start_at <= row.posted_at <= header.settlement_end_at:
        before = row.posted_at < header.settlement_start_at
        boundary = header.settlement_start_at if before else header.settlement_end_at
        diagnostics.append(
            {
                **base,
                "kind": "POSTED_TIMESTAMP_OUTSIDE_PERIOD",
                "posted_at": row.posted_at.isoformat(),
                "boundary_at": boundary.isoformat(),
                "direction": "BEFORE" if before else "AFTER",
                "difference": str(row.posted_at - boundary),
            }
        )
    if not header.settlement_start_date <= row.posted_date <= header.settlement_end_date:
        before = row.posted_date < header.settlement_start_date
        boundary_date = header.settlement_start_date if before else header.settlement_end_date
        diagnostics.append(
            {
                **base,
                "kind": "POSTED_DATE_OUTSIDE_PERIOD",
                "posted_date": row.posted_date.isoformat(),
                "boundary_date": boundary_date.isoformat(),
                "direction": "BEFORE" if before else "AFTER",
                "difference_days": (row.posted_date - boundary_date).days,
            }
        )
    return diagnostics
