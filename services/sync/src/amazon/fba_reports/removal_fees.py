"""Normalize FBA Removal Order Detail TSV rows into exact SKU fee evidence."""

from ..auxiliary_fees import AuxiliaryFeeObservation, AuxiliaryFeeSource
from .models import ParsedFbaReportDocument
from .quantities import optional_nonnegative_quantity
from .report_types import FBA_REMOVAL_ORDER_DETAIL_REPORT
from .tabular import (
    currency_code,
    iter_normalized_parsed_tsv_rows,
    optional_nonzero_charge,
    report_date_token,
    report_row_reference_hash,
    required_value,
)

_REPORT_NAME = "FBA removal report"
_REQUIRED_COLUMNS = frozenset(
    {
        "request-date",
        "order-id",
        "order-type",
        "sku",
        "disposed-quantity",
        "removal-fee",
        "currency",
    }
)


def normalize_parsed_removal_fee_document(
    document: ParsedFbaReportDocument,
    *,
    marketplace_id: str,
) -> tuple[AuxiliaryFeeObservation, ...]:
    """Validate and derive removal/disposal observations from parsed rows."""
    if document.report_type != FBA_REMOVAL_ORDER_DETAIL_REPORT:
        raise ValueError("Parsed report is not a removal-order detail report.")
    observations: list[AuxiliaryFeeObservation] = []
    for source_line_number, row in iter_normalized_parsed_tsv_rows(
        document,
        report_name=_REPORT_NAME,
        required_columns=_REQUIRED_COLUMNS,
    ):
        observation = _normalize_removal_fee_row(
            row,
            source_line_number=source_line_number,
            marketplace_id=marketplace_id,
        )
        if observation is not None:
            observations.append(observation)
    return tuple(observations)


def _normalize_removal_fee_row(
    row: dict[str, str],
    *,
    source_line_number: int,
    marketplace_id: str,
) -> AuxiliaryFeeObservation | None:
    source_amount = optional_nonzero_charge(
        row["removal-fee"],
        "removal-fee",
        report_name="FBA removal",
    )
    if source_amount is None:
        return None

    removal_order_id = required_value(
        row,
        "order-id",
        source_line_number,
        report_name=_REPORT_NAME,
    )
    amz_sku = required_value(
        row,
        "sku",
        source_line_number,
        report_name=_REPORT_NAME,
    )
    request_date = report_date_token(
        required_value(
            row,
            "request-date",
            source_line_number,
            report_name=_REPORT_NAME,
        ),
        "request-date",
        report_name="FBA removal",
    )
    order_type = required_value(
        row,
        "order-type",
        source_line_number,
        report_name=_REPORT_NAME,
    )
    category = _removal_fee_category(order_type)
    quantity_field = "disposed-quantity" if category == "DISPOSAL_FEES" else "shipped-quantity"
    quantity = optional_nonnegative_quantity(
        row.get(quantity_field, ""),
        quantity_field,
        report_name="FBA removal",
    )
    currency = currency_code(
        required_value(
            row,
            "currency",
            source_line_number,
            report_name=_REPORT_NAME,
        ),
        "currency",
        report_name="FBA removal",
    )
    return AuxiliaryFeeObservation(
        source_system=AuxiliaryFeeSource.FBA_REPORT,
        observed_start_date=request_date,
        observed_end_date=request_date,
        marketplace_id=marketplace_id,
        category_code=category,
        amz_sku=amz_sku,
        currency=currency,
        reported_amount=source_amount,
        normalized_amount=-source_amount,
        quantity=quantity,
        source_reference_hash=report_row_reference_hash(
            FBA_REMOVAL_ORDER_DETAIL_REPORT,
            row,
            source_line_number,
        ),
        source_grain={
            "grain": "REMOVAL_ORDER_MSKU_REPORT_LINE",
            "report_type": FBA_REMOVAL_ORDER_DETAIL_REPORT,
            "source_line_number": source_line_number,
        },
        taxonomy={
            "order_type": order_type,
            "disposition": row.get("disposition", ""),
            "disposed_quantity": row["disposed-quantity"],
            "shipped_quantity": row.get("shipped-quantity", ""),
        },
        removal_order_id=removal_order_id,
    )


def _removal_fee_category(order_type: str) -> str:
    normalized_order_type = order_type.casefold()
    if normalized_order_type == "disposal":
        return "DISPOSAL_FEES"
    if normalized_order_type == "return":
        return "REMOVAL_FEES"
    raise ValueError("FBA removal order-type is unsupported.")


__all__ = ["normalize_parsed_removal_fee_document"]
