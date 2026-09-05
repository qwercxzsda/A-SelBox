"""Stage-two business normalization for parsed Data Kiosk Economics documents."""

from dataclasses import dataclass, field

from .economics_fact_normalization import normalize_parsed_daily_msku_economics_facts
from .economics_models import DailyMskuEconomicsFact
from .economics_source_parsing import ParsedEconomicsDocuments
from .errors import DataKioskResponseError


@dataclass(frozen=True)
class ParsedEconomicsFacts:
    """Complete normalized facts from one successful in-memory parse."""

    facts: tuple[DailyMskuEconomicsFact, ...] = field(repr=False)


def normalize_parsed_economics_documents(
    parsed: ParsedEconomicsDocuments,
) -> ParsedEconomicsFacts:
    """Apply Economics schema, value, scope-key, and duplicate validation."""
    facts: list[DailyMskuEconomicsFact] = []
    seen_fact_keys: set[tuple[object, ...]] = set()
    for page in parsed.pages:
        parsed_document = page.parsed_document
        if parsed_document is None:
            continue
        source_document_id = page.document_id
        if source_document_id is None:
            raise ValueError("A parsed DATA page must retain its document identity.")
        for fact in normalize_parsed_daily_msku_economics_facts(
            parsed_document,
            source_document_id=source_document_id,
        ):
            if fact.natural_key in seen_fact_keys:
                raise DataKioskResponseError(
                    "Data Kiosk returned a duplicate normalized item across data pages."
                )
            seen_fact_keys.add(fact.natural_key)
            facts.append(fact)
    return ParsedEconomicsFacts(facts=tuple(facts))


__all__ = [
    "ParsedEconomicsFacts",
    "normalize_parsed_economics_documents",
]
