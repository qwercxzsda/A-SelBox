"""Business normalization of simple-parsed Data Kiosk Economics rows."""

from collections.abc import Iterable, Mapping
from datetime import date

from .economics_fact_sections import (
    normalize_ads,
    normalize_cost,
    normalize_fees,
    normalize_net_proceeds,
    normalize_sales,
)
from .economics_models import DailyMskuEconomicsFact
from .economics_parsing import (
    EconomicsRowContext,
    optional_string,
    parse_row_context,
    raise_invalid,
    required_object,
    required_string,
)
from .errors import DataKioskEconomicsNormalizationError
from .models import ParsedJsonlDocument


def normalize_parsed_daily_msku_economics_facts(
    document: ParsedJsonlDocument,
    *,
    source_document_id: str,
) -> tuple[DailyMskuEconomicsFact, ...]:
    """Apply all Economics schema and business validation to parsed rows."""
    if not source_document_id or source_document_id != source_document_id.strip():
        raise ValueError("source_document_id must not be empty.")

    facts: list[DailyMskuEconomicsFact] = []
    for parsed_row in document.rows:
        context = parse_row_context(document, parsed_row, source_document_id)
        if context.start_date != context.end_date:
            raise_invalid(context.source_line_number, "startDate/endDate DAY grain")
        facts.append(_normalize_fact(parsed_row.value, context))
    return tuple(facts)


def validate_daily_msku_economics_fact_scope(
    facts: Iterable[DailyMskuEconomicsFact],
    *,
    marketplace_id: str,
    start_date: date,
    end_date: date,
) -> None:
    """Require every normalized fact to match its submitted marketplace/window."""
    if not marketplace_id.strip():
        raise ValueError("marketplace_id must not be empty.")
    if start_date > end_date:
        raise ValueError("start_date must not be after end_date.")
    for fact in facts:
        if fact.marketplace_id != marketplace_id:
            raise DataKioskEconomicsNormalizationError(
                "A Data Kiosk Economics fact did not match the requested marketplace."
            )
        if fact.start_date < start_date or fact.end_date > end_date:
            raise DataKioskEconomicsNormalizationError(
                "A Data Kiosk Economics fact fell outside the requested date window."
            )


def _normalize_fact(
    row: Mapping[str, object],
    context: EconomicsRowContext,
) -> DailyMskuEconomicsFact:
    """Assemble one fact after each independent section passes validation."""
    line_number = context.source_line_number
    return DailyMskuEconomicsFact(
        start_date=context.start_date,
        end_date=context.end_date,
        marketplace_id=context.marketplace_id,
        msku=context.amz_sku,
        child_asin=optional_string(row, "childAsin", line_number, "childAsin"),
        fnsku=optional_string(row, "fnsku", line_number, "fnsku"),
        parent_asin=required_string(row, "parentAsin", line_number),
        sales=normalize_sales(
            required_object(row, "sales", line_number, "economics"),
            line_number,
        ),
        fees=normalize_fees(row, context),
        ads=normalize_ads(row, line_number),
        cost=normalize_cost(row, line_number),
        net_proceeds=normalize_net_proceeds(
            required_object(row, "netProceeds", line_number, "economics"),
            line_number,
        ),
        source_line_number=line_number,
        document_sha256=context.document_sha256,
        source_document_id=context.source_document_id,
    )


__all__ = [
    "normalize_parsed_daily_msku_economics_facts",
    "validate_daily_msku_economics_fact_scope",
]
