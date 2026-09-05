"""Transient batches of normalized auxiliary fee evidence."""

from dataclasses import dataclass, field
from datetime import date

from ..marketplaces import validate_marketplace_scope_pair
from .models import (
    AuxiliaryFeeObservation,
    AuxiliaryFeeSource,
)


@dataclass(frozen=True)
class AuxiliaryFeeBatch:
    """Normalized transient evidence for exactly one Settlement report."""

    settlement_report_id: str
    source_system: AuxiliaryFeeSource
    seller_namespace: str
    amazon_scope: str
    marketplace_id: str
    source_start_date: date
    source_end_date: date
    observations: tuple[AuxiliaryFeeObservation, ...] = field(default=(), repr=False)

    def __post_init__(self) -> None:
        """Reject cross-source or cross-marketplace evidence before processing."""
        _validate_batch_identity(self)
        if self.source_start_date > self.source_end_date:
            raise ValueError("source_start_date must not be after source_end_date.")
        _validate_batch_observations(self)


def _validate_batch_identity(batch: AuxiliaryFeeBatch) -> None:
    for field_name, value in (
        ("settlement_report_id", batch.settlement_report_id),
        ("seller_namespace", batch.seller_namespace),
        ("amazon_scope", batch.amazon_scope),
        ("marketplace_id", batch.marketplace_id),
    ):
        if not value.strip():
            raise ValueError(f"{field_name} must not be blank.")
    validate_marketplace_scope_pair(batch.amazon_scope, batch.marketplace_id)


def _validate_batch_observations(batch: AuxiliaryFeeBatch) -> None:
    reference_hashes: set[str] = set()
    for observation in batch.observations:
        if observation.source_system != batch.source_system:
            raise ValueError("Every observation must use the batch source_system.")
        if observation.marketplace_id != batch.marketplace_id:
            raise ValueError("Every observation must use the batch marketplace_id.")
        if (
            observation.observed_start_date < batch.source_start_date
            or observation.observed_end_date > batch.source_end_date
        ):
            raise ValueError("Every observation must be contained by the batch source period.")
        if observation.source_reference_hash in reference_hashes:
            raise ValueError("Observation source_reference_hash values must be unique.")
        reference_hashes.add(observation.source_reference_hash)


__all__ = ["AuxiliaryFeeBatch"]
