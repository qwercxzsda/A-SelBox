"""Parse and validate a complete archived settlement into immutable source facts."""

from collections.abc import Mapping

from ..amazon.marketplace_names import validate_marketplace_name
from ..amazon.settlement_models import ParsedSettlementReport
from ..amazon.settlement_parser import parse_settlement_report
from ..amazon.settlement_values import (
    parse_currency_code,
    parse_settlement_amount,
    parse_settlement_date,
    parse_settlement_quantity,
    parse_settlement_timestamp,
)
from ..numeric import ZERO
from ..preprocess_version import PREPROCESS_VERSION
from .classification import classify_settlement_row
from .diagnostics import transaction_diagnostics
from .models import PreparedSettlement, SettlementHeader, SettlementTransaction
from .retrocharges import validate_retrocharge_groups


def prepare_settlement_report(
    document: bytes,
    *,
    retrocharge_coverage: tuple[tuple[int, ...], ...] = (),
) -> PreparedSettlement:
    """Validate all rows together, with no ownership, rate, or Amazon dependencies."""
    parsed = parse_settlement_report(document)
    try:
        header = _parse_header(parsed)
    except ValueError as error:
        error.add_note(
            f"Settlement metadata source_line={parsed.metadata_source_line_number}; "
            f"preprocess_version={PREPROCESS_VERSION}."
        )
        raise
    diagnostics: list[dict[str, object]] = [
        {
            "kind": "TRAILING_EMPTY_FIELDS",
            "source_line_number": item.source_line_number,
            "original_field_count": item.original_field_count,
            "omitted_column_names": list(item.omitted_column_names),
            "preprocess_version": PREPROCESS_VERSION,
        }
        for item in parsed.normalization_diagnostics
    ]
    transactions: list[SettlementTransaction] = []
    for source in parsed.content_rows:
        fields = dict(zip(parsed.tsv_columns, source.column_values, strict=True))
        try:
            row = _parse_transaction(fields, source.source_line_number, header)
        except ValueError as error:
            component = tuple(
                fields[name] for name in ("transaction-type", "amount-type", "amount-description")
            )
            error.add_note(
                f"Settlement={header.settlement_id}; source_line={source.source_line_number}; "
                f"component={component!r}; sku={fields['sku']!r}; "
                f"marketplace={fields['marketplace-name']!r}; amount={fields['amount']!r}; "
                f"preprocess_version={PREPROCESS_VERSION}."
            )
            raise
        transactions.append(row)
        diagnostics.extend(transaction_diagnostics(row, header))
    content_total = sum((row.amount for row in transactions), ZERO)
    if content_total != header.total_amount:
        raise ValueError(
            "Settlement content rows do not reconcile to the metadata total: "
            f"expected={header.total_amount}; actual={content_total}; "
            f"currency={header.currency}; preprocess_version={PREPROCESS_VERSION}."
        )
    try:
        validate_retrocharge_groups(transactions, retrocharge_coverage)
    except ValueError as error:
        lines = tuple(row.source_line_number for row in transactions if row.family == "F7")
        error.add_note(
            f"Settlement={header.settlement_id}; retrocharge_source_lines={lines}; "
            f"reviewed_coverage={retrocharge_coverage}; preprocess_version={PREPROCESS_VERSION}."
        )
        raise
    if retrocharge_coverage:
        diagnostics.append(
            {
                "kind": "REVIEWED_RETROCHARGE_COVERAGE",
                "complete_source_line_groups": [list(group) for group in retrocharge_coverage],
                "preprocess_version": PREPROCESS_VERSION,
            }
        )
    return PreparedSettlement(
        header, tuple(transactions), tuple(diagnostics), parsed.decoded_content_sha256
    )


def _parse_header(parsed: ParsedSettlementReport) -> SettlementHeader:
    metadata = dict(zip(parsed.tsv_columns, parsed.metadata_values, strict=True))
    start = parse_settlement_timestamp(_required(metadata, "settlement-start-date"))
    end = parse_settlement_timestamp(_required(metadata, "settlement-end-date"))
    if start > end or start.date() > end.date():
        raise ValueError("Settlement start timestamp/date is after its end.")
    return SettlementHeader(
        settlement_id=_required(metadata, "settlement-id"),
        settlement_start_at=start,
        settlement_end_at=end,
        deposit_at=parse_settlement_timestamp(_required(metadata, "deposit-date")),
        settlement_start_date=start.date(),
        settlement_end_date=end.date(),
        total_amount=parse_settlement_amount(_required(metadata, "total-amount")),
        currency=parse_currency_code(_required(metadata, "currency")),
        source_line_number=parsed.metadata_source_line_number,
    )


def _parse_transaction(
    fields: dict[str, str],
    line: int,
    header: SettlementHeader,
) -> SettlementTransaction:
    if _required(fields, "settlement-id") != header.settlement_id:
        raise ValueError(f"Settlement row {line} has a different settlement-id.")
    posted_at = parse_settlement_timestamp(_required(fields, "posted-date-time"))
    posted_date = parse_settlement_date(_required(fields, "posted-date"))
    if posted_at.date() != posted_date:
        raise ValueError(f"Settlement row {line} has inconsistent posted dates.")
    category, family, component, subtype = classify_settlement_row(fields)
    marketplace = fields["marketplace-name"].strip() or None
    if marketplace is not None:
        validate_marketplace_name(marketplace)
    return SettlementTransaction(
        source_line_number=line,
        category=category,
        family=family,
        component_type=component,
        accounting_subtype=subtype,
        sku=fields["sku"] if fields["sku"].strip() else None,
        marketplace_name=marketplace,
        amount=parse_settlement_amount(_required(fields, "amount")),
        currency=header.currency,
        quantity=parse_settlement_quantity(fields["quantity-purchased"]),
        posted_date=posted_date,
        posted_at=posted_at,
        transaction_type=_required(fields, "transaction-type"),
        amount_type=_required(fields, "amount-type"),
        amount_description=_required(fields, "amount-description"),
        source_fields=fields,
    )


def _required(row: Mapping[str, str], column: str) -> str:
    value = row.get(column, "")
    if not value.strip():
        raise ValueError(f"Settlement preprocessing requires column {column}.")
    return value.strip()
