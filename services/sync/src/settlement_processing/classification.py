"""Classify typed Settlement entries using versioned Python policy."""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import date

from .models import (
    CategoryMappingRule,
    ClassifiedEntry,
    CompanyResolution,
    CompanySkuFeeRateCandidate,
    HandlingMethod,
    LedgerEntry,
)

type CompanySkuFeeRateKey = tuple[str, str]
type CompanySkuFeeRateCandidateIndex = Mapping[
    CompanySkuFeeRateKey,
    tuple[CompanySkuFeeRateCandidate, ...],
]


def index_company_sku_fee_rate_candidates(
    fee_rate_candidates: Sequence[CompanySkuFeeRateCandidate],
) -> dict[CompanySkuFeeRateKey, tuple[CompanySkuFeeRateCandidate, ...]]:
    """Group fee-rate candidates by their exact marketplace/SKU lookup key."""
    grouped: defaultdict[CompanySkuFeeRateKey, list[CompanySkuFeeRateCandidate]] = defaultdict(list)
    for fee_rate in fee_rate_candidates:
        grouped[(fee_rate.marketplace_id, fee_rate.amz_sku)].append(fee_rate)
    return {key: tuple(rows) for key, rows in grouped.items()}


def classify_ledger_entry(
    entry: LedgerEntry,
    rules: Sequence[CategoryMappingRule],
) -> ClassifiedEntry:
    """Classify known taxonomy even when a missing SKU prevents direct assignment."""
    return _classify_ledger_entry(entry, sorted(rules, key=lambda item: item.priority))


def classify_ledger_entries(
    entries: Sequence[LedgerEntry],
    rules: Sequence[CategoryMappingRule],
) -> list[ClassifiedEntry]:
    """Classify a ledger batch after ordering its mapping release once."""
    ordered_rules = sorted(rules, key=lambda item: item.priority)
    return [_classify_ledger_entry(entry, ordered_rules) for entry in entries]


def _classify_ledger_entry(
    entry: LedgerEntry,
    ordered_rules: Sequence[CategoryMappingRule],
) -> ClassifiedEntry:
    direct_rule_missing_sku: CategoryMappingRule | None = None
    for rule in ordered_rules:
        if rule.transaction_type is not None and rule.transaction_type != entry.transaction_type:
            continue
        if rule.amount_type is not None and rule.amount_type != entry.amount_type:
            continue
        if (
            rule.amount_description is not None
            and rule.amount_description != entry.amount_description
        ):
            continue
        is_direct_rule = rule.pnl_treatment == "SKU_PNL" and (
            rule.preferred_auxiliary_source is None
        )
        if is_direct_rule and entry.amz_sku is None:
            if direct_rule_missing_sku is None:
                direct_rule_missing_sku = rule
            continue
        return ClassifiedEntry(
            ledger_entry=entry,
            category_code=rule.category_code,
            pnl_treatment=rule.pnl_treatment,
            handling_method=_rule_handling_method(rule),
            preferred_auxiliary_source=rule.preferred_auxiliary_source,
        )

    if direct_rule_missing_sku is not None:
        return ClassifiedEntry(
            ledger_entry=entry,
            category_code=direct_rule_missing_sku.category_code,
            pnl_treatment=direct_rule_missing_sku.pnl_treatment,
            handling_method="UNASSIGNED",
            preferred_auxiliary_source=None,
        )

    handling_method: HandlingMethod = "UNASSIGNED"
    if entry.amz_sku is not None and entry.amount_type in {
        "ItemPrice",
        "ItemFees",
        "ItemWithheldTax",
        "Promotion",
    }:
        handling_method = "DIRECT_SKU"
    return ClassifiedEntry(entry, "UNMAPPED", "SKU_PNL", handling_method, None)


def _rule_handling_method(rule: CategoryMappingRule) -> HandlingMethod:
    if rule.pnl_treatment == "EXCLUDED":
        return "EXCLUDED"
    if rule.pnl_treatment == "ACCOUNT_EXPENSE":
        return "UNASSIGNED"
    if rule.preferred_auxiliary_source is not None:
        return "AUXILIARY_EVIDENCE"
    return "DIRECT_SKU"


def resolve_company(
    marketplace_id: str | None,
    amz_sku: str,
    posted_date: date,
    fee_rates_by_key: CompanySkuFeeRateCandidateIndex,
) -> CompanyResolution | None:
    """Resolve one exact marketplace/SKU/date company and fee-rate row."""
    if marketplace_id is None:
        return None
    return _resolve_company_for_period(
        marketplace_id,
        amz_sku,
        posted_date,
        posted_date,
        fee_rates_by_key,
        f"marketplace/SKU/date: {marketplace_id}/{amz_sku}/{posted_date}",
    )


def resolve_company_for_interval(
    marketplace_id: str,
    amz_sku: str,
    first_date: date,
    last_date: date,
    fee_rates_by_key: CompanySkuFeeRateCandidateIndex,
) -> CompanyResolution | None:
    """Resolve one fee-rate row that covers a target's complete activity interval."""
    if first_date > last_date:
        raise ValueError("Auxiliary company-resolution interval is inverted.")
    return _resolve_company_for_period(
        marketplace_id,
        amz_sku,
        first_date,
        last_date,
        fee_rates_by_key,
        f"marketplace/SKU/interval: {marketplace_id}/{amz_sku}/{first_date}..{last_date}",
    )


def _resolve_company_for_period(
    marketplace_id: str,
    amz_sku: str,
    first_date: date,
    last_date: date,
    fee_rates_by_key: CompanySkuFeeRateCandidateIndex,
    match_description: str,
) -> CompanyResolution | None:
    """Resolve the one combined company/SKU/rate row covering the period."""
    fee_rates = {
        fee_rate.company_sku_fee_rate_id: fee_rate
        for fee_rate in fee_rates_by_key.get((marketplace_id, amz_sku), ())
        if fee_rate.valid_from <= first_date
        and (fee_rate.valid_to is None or last_date < fee_rate.valid_to)
    }
    if len(fee_rates) > 1:
        raise ValueError(f"Multiple company/SKU fee rates match {match_description}.")
    if not fee_rates:
        return None

    fee_rate = next(iter(fee_rates.values()))
    return CompanyResolution(
        company_sku_fee_rate_id=fee_rate.company_sku_fee_rate_id,
        company_id=fee_rate.company_id,
        fee_rate_percent=fee_rate.fee_rate_percent,
    )


__all__ = [
    "CompanySkuFeeRateCandidateIndex",
    "classify_ledger_entries",
    "classify_ledger_entry",
    "index_company_sku_fee_rate_candidates",
    "resolve_company",
    "resolve_company_for_interval",
]
