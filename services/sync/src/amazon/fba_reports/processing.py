"""Stage-two business processing of structurally parsed FBA report documents."""

from datetime import date, datetime

from ..auxiliary_fees import (
    AuxiliaryFeeBatch,
    AuxiliaryFeeObservation,
    AuxiliaryFeeSource,
)
from ..reports.summaries import DoneReportSummary
from .aged_storage_fees import normalize_parsed_aged_storage_fee_document
from .models import (
    AgedStorageReportWindow,
    ParsedFbaReportDocument,
)
from .removal_fees import normalize_parsed_removal_fee_document
from .requests import validate_aged_storage_window, validate_removal_window


def build_aged_storage_fee_batch_from_parsed(
    report: DoneReportSummary,
    parsed_document: ParsedFbaReportDocument,
    *,
    settlement_report_id: str,
    seller_namespace: str,
    amazon_scope: str,
    marketplace_id: str,
    window: AgedStorageReportWindow,
) -> AuxiliaryFeeBatch:
    """Apply aged-storage policy to a successful simple-parse result."""
    _validate_parsed_scope(parsed_document, amazon_scope)
    validate_aged_storage_window(window)
    _validate_report_summary(
        report,
        marketplace_id=marketplace_id,
        data_start_at=window.evidence_start_at,
        data_end_at=window.evidence_end_at,
        report_name="aged-storage",
        window_name="evidence",
    )
    observations = _within_date_window(
        normalize_parsed_aged_storage_fee_document(
            parsed_document,
            marketplace_id=marketplace_id,
        ),
        start_date=window.evidence_start_at.date(),
        end_date=window.evidence_end_at.date(),
    )
    return AuxiliaryFeeBatch(
        settlement_report_id=settlement_report_id,
        source_system=AuxiliaryFeeSource.FBA_REPORT,
        seller_namespace=seller_namespace,
        amazon_scope=amazon_scope,
        marketplace_id=marketplace_id,
        source_start_date=window.evidence_start_at.date(),
        source_end_date=window.evidence_end_at.date(),
        observations=observations,
    )


def build_removal_fee_batch_from_parsed(
    report: DoneReportSummary,
    parsed_document: ParsedFbaReportDocument,
    *,
    settlement_report_id: str,
    seller_namespace: str,
    amazon_scope: str,
    marketplace_id: str,
    data_start_at: datetime,
    data_end_at: datetime,
) -> AuxiliaryFeeBatch:
    """Apply removal/disposal policy to a successful simple-parse result."""
    _validate_parsed_scope(parsed_document, amazon_scope)
    validate_removal_window(data_start_at, data_end_at)
    _validate_report_summary(
        report,
        marketplace_id=marketplace_id,
        data_start_at=data_start_at,
        data_end_at=data_end_at,
        report_name="removal",
        window_name="requested",
    )
    observations = _within_date_window(
        normalize_parsed_removal_fee_document(
            parsed_document,
            marketplace_id=marketplace_id,
        ),
        start_date=data_start_at.date(),
        end_date=data_end_at.date(),
    )
    return AuxiliaryFeeBatch(
        settlement_report_id=settlement_report_id,
        source_system=AuxiliaryFeeSource.FBA_REPORT,
        seller_namespace=seller_namespace,
        amazon_scope=amazon_scope,
        marketplace_id=marketplace_id,
        source_start_date=data_start_at.date(),
        source_end_date=data_end_at.date(),
        observations=observations,
    )


def _validate_parsed_scope(
    parsed_document: ParsedFbaReportDocument,
    amazon_scope: str,
) -> None:
    if parsed_document.amazon_scope != amazon_scope:
        raise ValueError("Parsed FBA report scope does not match processing scope.")


def _validate_report_summary(
    report: DoneReportSummary,
    *,
    marketplace_id: str,
    data_start_at: datetime,
    data_end_at: datetime,
    report_name: str,
    window_name: str,
) -> None:
    if report.marketplace_ids != (marketplace_id,):
        raise ValueError(f"Retained {report_name} report marketplace does not match the request.")
    if (
        report.data_start_at is None
        or report.data_end_at is None
        or report.data_start_at > data_start_at
        or report.data_end_at < data_end_at
    ):
        raise ValueError(f"Retained {report_name} report does not cover the {window_name} window.")


def _within_date_window(
    observations: tuple[AuxiliaryFeeObservation, ...],
    *,
    start_date: date,
    end_date: date,
) -> tuple[AuxiliaryFeeObservation, ...]:
    return tuple(
        observation
        for observation in observations
        if observation.observed_start_date <= end_date
        and observation.observed_end_date >= start_date
    )


__all__ = [
    "build_aged_storage_fee_batch_from_parsed",
    "build_removal_fee_batch_from_parsed",
]
