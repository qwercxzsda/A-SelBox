"""Verified non-retail Finances identities, without Summary or Data Kiosk aliases."""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

NON_AMAZON_US_ID = "A2ZV50J4W1RKNI"
NON_AMAZON_DE_ID = "A38D8NSA03LJTC"
NON_AMAZON_IT_ID = "A62U237T8HV6N"


@dataclass(frozen=True, slots=True)
class FinancialChannel:
    marketplace_name: str
    amazon_scope: str
    time_zone: str


FINANCIAL_CHANNELS: Mapping[str, FinancialChannel] = MappingProxyType(
    {
        NON_AMAZON_US_ID: FinancialChannel("Non-Amazon US", "NA", "America/Los_Angeles"),
        NON_AMAZON_DE_ID: FinancialChannel("Non-Amazon DE", "EU", "Europe/Berlin"),
        NON_AMAZON_IT_ID: FinancialChannel("Non-Amazon IT", "EU", "Europe/Rome"),
    }
)


def financial_channel_ids(amazon_scope: str) -> frozenset[str]:
    """Candidates require actual Sellers participation before entering coverage."""
    return frozenset(
        identifier
        for identifier, channel in FINANCIAL_CHANNELS.items()
        if channel.amazon_scope == amazon_scope
    )
