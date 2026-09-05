"""Derive normalized auxiliary fee evidence from typed Data Kiosk Economics facts."""

import json
from collections.abc import Iterable, Mapping
from datetime import date
from hashlib import sha256

from ...numeric import Numeric
from ..auxiliary_fees import AuxiliaryFeeObservation, AuxiliaryFeeSource
from .economics_models import DailyMskuEconomicsFact
from .economics_taxonomy import (
    canonicalize_economics_taxonomy,
    classify_ad_charge,
    classify_auxiliary_fee,
)
from .query_builder import ECONOMICS_SCHEMA_NAME


def derive_economics_fee_observations(
    facts: Iterable[DailyMskuEconomicsFact],
) -> tuple[AuxiliaryFeeObservation, ...]:
    """Derive supported Settlement-attribution observations from typed facts."""
    observations: list[AuxiliaryFeeObservation] = []
    for fact in facts:
        observations.extend(_fee_observations(fact))
        observations.extend(_ad_observations(fact))
    return tuple(observations)


def _fee_observations(
    fact: DailyMskuEconomicsFact,
) -> list[AuxiliaryFeeObservation]:
    observations: list[AuxiliaryFeeObservation] = []
    for fee_index, fee in enumerate(fact.fees):
        category_code = classify_auxiliary_fee(fee.fee_type_name)
        if category_code is None or fee.start_date is None or fee.end_date is None:
            continue
        amount = fee.aggregated_detail.total_amount
        if not amount.amount:
            continue
        source_reference_hash = _source_reference_hash(
            fact,
            collection="fees",
            item_index=fee_index,
            external_identifier=fee.identifier,
        )
        observations.append(
            _observation(
                fact=fact,
                category_code=category_code,
                currency=amount.currency_code,
                source_amount=amount.amount,
                quantity=fee.aggregated_detail.quantity,
                observed_start=fee.start_date,
                observed_end=fee.end_date,
                source_reference_hash=source_reference_hash,
                source_grain={
                    **_base_grain(fact),
                    "collection": "fees",
                    "fee_charge_index": fee_index,
                },
                taxonomy={
                    "source_amount_sign": _amount_sign(amount.amount),
                    "fee_type_name": fee.fee_type_name,
                    "canonical_fee_type_name": canonicalize_economics_taxonomy(fee.fee_type_name),
                },
            )
        )
    return observations


def _ad_observations(
    fact: DailyMskuEconomicsFact,
) -> list[AuxiliaryFeeObservation]:
    observations: list[AuxiliaryFeeObservation] = []
    for ad_index, ad in enumerate(fact.ads):
        if ad.charge is None:
            continue
        amount = ad.charge.total_amount
        if not amount.amount:
            continue
        source_reference_hash = _source_reference_hash(
            fact,
            collection="ads",
            item_index=ad_index,
            external_identifier=None,
        )
        observations.append(
            _observation(
                fact=fact,
                category_code=classify_ad_charge(ad.ad_type_name),
                currency=amount.currency_code,
                source_amount=amount.amount,
                quantity=ad.charge.quantity,
                observed_start=fact.start_date,
                observed_end=fact.end_date,
                source_reference_hash=source_reference_hash,
                source_grain={
                    **_base_grain(fact),
                    "collection": "ads",
                    "ad_summary_index": ad_index,
                },
                taxonomy={
                    "source_amount_sign": _amount_sign(amount.amount),
                    "ad_type_name": ad.ad_type_name,
                    "canonical_ad_type_name": canonicalize_economics_taxonomy(ad.ad_type_name),
                },
            )
        )
    return observations


def _amount_sign(amount: Numeric) -> str:
    """Describe the sign of one nonzero observation without inferring event type."""
    return "NEGATIVE" if amount < 0 else "POSITIVE"


def _observation(
    *,
    fact: DailyMskuEconomicsFact,
    category_code: str,
    currency: str,
    source_amount: Numeric,
    quantity: Numeric | None,
    observed_start: date,
    observed_end: date,
    source_reference_hash: str,
    source_grain: Mapping[str, object],
    taxonomy: Mapping[str, object],
) -> AuxiliaryFeeObservation:
    return AuxiliaryFeeObservation(
        source_system=AuxiliaryFeeSource.DATA_KIOSK,
        observed_start_date=observed_start,
        observed_end_date=observed_end,
        marketplace_id=fact.marketplace_id,
        category_code=category_code,
        amz_sku=fact.msku,
        currency=currency,
        reported_amount=source_amount,
        normalized_amount=-source_amount,
        quantity=quantity,
        source_reference_hash=source_reference_hash,
        source_grain=source_grain,
        taxonomy=taxonomy,
    )


def _base_grain(fact: DailyMskuEconomicsFact) -> dict[str, object]:
    return {
        "dataset": ECONOMICS_SCHEMA_NAME,
        "date_granularity": "DAY",
        "product_identifier_granularity": "MSKU",
        "source_document_id": fact.source_document_id,
        "source_line_number": fact.source_line_number,
        "document_sha256": fact.document_sha256,
        "amount_field": "totalAmount",
    }


def _source_reference_hash(
    fact: DailyMskuEconomicsFact,
    *,
    collection: str,
    item_index: int,
    external_identifier: str | None,
) -> str:
    payload: dict[str, object] = {
        "source_document_id": fact.source_document_id,
        "document_sha256": fact.document_sha256,
        "source_line_number": fact.source_line_number,
        "collection": collection,
        "item_index": item_index,
        "external_identifier": external_identifier,
    }
    reference = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return sha256(reference.encode()).hexdigest()


__all__ = ["derive_economics_fee_observations"]
