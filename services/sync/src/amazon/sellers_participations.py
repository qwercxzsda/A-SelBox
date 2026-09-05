from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol, cast

from sp_api.api import Sellers
from sp_api.base import ApiResponse, Marketplaces

from .client import create_explicit_sp_api_client
from .credentials import AmazonLwaCredentials, close_quietly
from .marketplaces import AmazonCredentialScope


@dataclass(frozen=True)
class MarketplaceParticipation:
    """Typed marketplace metadata returned for an active seller participation."""

    marketplace_id: str
    name: str
    domain_name: str


class SellersClient(Protocol):
    """Narrow Sellers API surface needed to discover marketplace participation."""

    def get_marketplace_participation(self) -> ApiResponse:
        """Return marketplace participation metadata for the authenticated seller."""
        ...

    def close(self) -> None:
        """Close client resources."""
        ...


class SellersParticipationResponseError(ValueError):
    """Raised when Amazon returns malformed or conflicting participation metadata."""


@dataclass(frozen=True)
class _ParsedParticipation:
    metadata: MarketplaceParticipation
    country_code: str
    is_participating: bool


class _ApiResponseWithPayload(Protocol):
    payload: object


def fetch_marketplace_participations(
    scope: AmazonCredentialScope,
    credentials: AmazonLwaCredentials,
) -> tuple[MarketplaceParticipation, ...]:
    """Fetch active marketplaces authorized by one exact credential scope."""
    client: SellersClient | None = None
    try:
        client = cast(
            SellersClient,
            create_explicit_sp_api_client(
                Sellers,
                scope.client_marketplace,
                credentials,
            ),
        )
        response = client.get_marketplace_participation()
        return _parse_participations(
            response,
            scope.marketplace_ids,
            {
                cast(str, marketplace.marketplace_id): marketplace.name
                for marketplace in Marketplaces
            },
        )
    finally:
        close_quietly(client)


def _parse_participations(
    response: ApiResponse,
    candidate_marketplace_ids: tuple[str, ...],
    canonical_country_by_marketplace_id: Mapping[str, str],
) -> tuple[MarketplaceParticipation, ...]:
    payload: object = cast(_ApiResponseWithPayload, response).payload
    if not isinstance(payload, list):
        raise SellersParticipationResponseError(
            "getMarketplaceParticipations returned a non-list payload."
        )

    by_marketplace_id: dict[str, _ParsedParticipation] = {}
    for entry in cast(list[object], payload):
        parsed = _parse_entry(entry)
        existing = by_marketplace_id.get(parsed.metadata.marketplace_id)
        if existing is not None and existing != parsed:
            raise SellersParticipationResponseError(
                "getMarketplaceParticipations returned conflicting duplicate marketplace entries."
            )
        by_marketplace_id[parsed.metadata.marketplace_id] = parsed

    for marketplace_id, parsed in by_marketplace_id.items():
        canonical_country_code = canonical_country_by_marketplace_id.get(marketplace_id)
        if canonical_country_code is not None and parsed.country_code != canonical_country_code:
            raise SellersParticipationResponseError(
                "getMarketplaceParticipations returned a canonical marketplace with an "
                "unexpected country code."
            )

    active_canonical_country_codes = frozenset(
        parsed.country_code
        for marketplace_id, parsed in by_marketplace_id.items()
        if parsed.is_participating and marketplace_id in canonical_country_by_marketplace_id
    )
    if any(
        parsed.is_participating
        and marketplace_id not in canonical_country_by_marketplace_id
        and parsed.country_code not in active_canonical_country_codes
        for marketplace_id, parsed in by_marketplace_id.items()
    ):
        raise SellersParticipationResponseError(
            "getMarketplaceParticipations returned an active marketplace without an active "
            "canonical store for its country."
        )

    participations: list[MarketplaceParticipation] = []
    for marketplace_id in candidate_marketplace_ids:
        parsed = by_marketplace_id.get(marketplace_id)
        if parsed is not None and parsed.is_participating:
            participations.append(parsed.metadata)
    return tuple(participations)


def _parse_entry(entry: object) -> _ParsedParticipation:
    if not isinstance(entry, Mapping):
        raise SellersParticipationResponseError(
            "getMarketplaceParticipations returned a non-object entry."
        )
    entry_mapping = cast(Mapping[str, object], entry)
    marketplace = _required_mapping(entry_mapping, "marketplace")
    participation = _required_mapping(entry_mapping, "participation")
    is_participating: object = participation.get("isParticipating")
    if not isinstance(is_participating, bool):
        raise SellersParticipationResponseError(
            "getMarketplaceParticipations returned an invalid participation flag."
        )

    return _ParsedParticipation(
        metadata=MarketplaceParticipation(
            marketplace_id=_required_text(marketplace, "id"),
            name=_required_text(marketplace, "name"),
            domain_name=_required_text(marketplace, "domainName"),
        ),
        country_code=_required_country_code(marketplace),
        is_participating=is_participating,
    )


def _required_country_code(payload: Mapping[str, object]) -> str:
    value = _required_text(payload, "countryCode")
    if len(value) != 2 or not value.isascii() or not value.isalpha() or value != value.upper():
        raise SellersParticipationResponseError(
            "getMarketplaceParticipations returned an invalid countryCode field."
        )
    return value


def _required_mapping(payload: Mapping[str, object], key: str) -> Mapping[str, object]:
    value: object = payload.get(key)
    if not isinstance(value, Mapping):
        raise SellersParticipationResponseError(
            f"getMarketplaceParticipations returned an invalid {key} object."
        )
    return cast(Mapping[str, object], value)


def _required_text(payload: Mapping[str, object], key: str) -> str:
    value: object = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise SellersParticipationResponseError(
            f"getMarketplaceParticipations returned an invalid {key} field."
        )
    return value.strip()
