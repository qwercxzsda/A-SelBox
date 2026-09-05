"""Normalize exact charged FBA aged-storage rows at Amazon MSKU grain."""

from ..auxiliary_fees import AuxiliaryFeeObservation, AuxiliaryFeeSource
from .models import ParsedFbaReportDocument
from .quantities import optional_nonnegative_quantity
from .report_types import FBA_AGED_STORAGE_FEE_REPORT
from .tabular import (
    currency_code,
    iter_normalized_parsed_tsv_rows,
    optional_nonzero_charge,
    report_date_token,
    report_row_reference_hash,
    required_value,
)

_REPORT_NAME = "FBA aged-storage fee report"
_OFFICIAL_COLUMNS = frozenset(
    {
        "snapshot-date",
        "sku",
        "fnsku",
        "asin",
        "product-name",
        "condition",
        "per-unit-volume",
        "currency",
        "volume-unit",
        "country",
        "qty-charged",
        "amount-charged",
        "surcharge-age-tier",
        "rate-surcharge",
    }
)


def normalize_parsed_aged_storage_fee_document(
    document: ParsedFbaReportDocument,
    *,
    marketplace_id: str,
) -> tuple[AuxiliaryFeeObservation, ...]:
    """Validate and derive exact aged-storage observations from parsed rows."""
    if document.report_type != FBA_AGED_STORAGE_FEE_REPORT:
        raise ValueError("Parsed report is not an aged-storage fee report.")
    observations: list[AuxiliaryFeeObservation] = []
    for source_line_number, row in iter_normalized_parsed_tsv_rows(
        document,
        report_name=_REPORT_NAME,
        required_columns=_OFFICIAL_COLUMNS,
    ):
        observation = _normalize_aged_storage_fee_row(
            row,
            source_line_number=source_line_number,
            marketplace_id=marketplace_id,
        )
        if observation is not None:
            observations.append(observation)
    return tuple(observations)


def _normalize_aged_storage_fee_row(
    row: dict[str, str],
    *,
    source_line_number: int,
    marketplace_id: str,
) -> AuxiliaryFeeObservation | None:
    reported_amount = optional_nonzero_charge(
        row["amount-charged"],
        "amount-charged",
        report_name="FBA aged-storage",
    )
    if reported_amount is None:
        return None

    observed_date = report_date_token(
        required_value(
            row,
            "snapshot-date",
            source_line_number,
            report_name=_REPORT_NAME,
        ),
        "snapshot-date",
        report_name="FBA aged-storage",
    )
    amz_sku = required_value(
        row,
        "sku",
        source_line_number,
        report_name=_REPORT_NAME,
    )
    currency = currency_code(
        required_value(
            row,
            "currency",
            source_line_number,
            report_name=_REPORT_NAME,
        ),
        "currency",
        report_name="FBA aged-storage",
    )
    reference_hash = report_row_reference_hash(
        FBA_AGED_STORAGE_FEE_REPORT,
        row,
        source_line_number,
    )
    return AuxiliaryFeeObservation(
        source_system=AuxiliaryFeeSource.FBA_REPORT,
        observed_start_date=observed_date,
        observed_end_date=observed_date,
        marketplace_id=marketplace_id,
        category_code="FBA_AGED_INVENTORY_FEES",
        amz_sku=amz_sku,
        currency=currency,
        reported_amount=reported_amount,
        normalized_amount=-reported_amount,
        quantity=optional_nonnegative_quantity(
            row["qty-charged"],
            "qty-charged",
            report_name="FBA aged-storage",
        ),
        source_reference_hash=reference_hash,
        source_grain={
            "grain": "FBA_AGED_STORAGE_MSKU_REPORT_LINE",
            "report_type": FBA_AGED_STORAGE_FEE_REPORT,
            "source_line_number": source_line_number,
            "amount_field": "amount-charged",
        },
        taxonomy={
            "fnsku": row["fnsku"],
            "asin": row["asin"],
            "condition": row["condition"],
            "country": row["country"],
            "quantity_charged": row["qty-charged"],
            "per_unit_volume": row["per-unit-volume"],
            "volume_unit": row["volume-unit"],
            "surcharge_age_tier": row["surcharge-age-tier"],
            "rate_surcharge": row["rate-surcharge"],
        },
    )


__all__ = ["normalize_parsed_aged_storage_fee_document"]
