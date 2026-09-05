"""Validate completed FBA report responses at the Reports API boundary."""

from collections.abc import Mapping, Sequence

from ..reports.summaries import DoneReportSummary, parse_done_report_summary


def parse_done_fba_report(
    report: Mapping[str, object],
    expected_report_type: str,
) -> DoneReportSummary:
    """Parse a strict report summary with the FBA lifecycle's error boundary."""
    try:
        summary = parse_done_report_summary(
            report,
            expected_report_types=(expected_report_type,),
        )
    except ValueError as error:
        raise RuntimeError(str(error)) from None
    return summary


def has_exact_marketplace_scope(
    report: DoneReportSummary,
    marketplace_ids: Sequence[str],
) -> bool:
    """Require an exact marketplace set without accepting duplicate report IDs."""
    return len(report.marketplace_ids) == len(marketplace_ids) and set(
        report.marketplace_ids
    ) == set(marketplace_ids)


__all__ = ["has_exact_marketplace_scope", "parse_done_fba_report"]
