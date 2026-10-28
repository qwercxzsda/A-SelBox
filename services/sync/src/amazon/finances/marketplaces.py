"""Discover native financial channels without assuming every store has each one."""

from collections.abc import Mapping
from typing import Protocol, cast

from sp_api.api import Sellers

from ..client import create_explicit_sp_api_client
from ..credentials import AmazonLwaCredentials, close_quietly
from ..financial_channels import financial_channel_ids
from ..marketplaces import AmazonCredentialScope
from ..sellers_participations import SellersClient, SellersParticipationRequestError
from ..transport import sanitized_throttled_api_call


class _PayloadResponse(Protocol):
    payload: object


def fetch_financial_marketplace_ids(
    scope: AmazonCredentialScope, credentials: AmazonLwaCredentials
) -> tuple[str, ...]:
    """Include only actual participating stores and verified financial channels.

    Sellers can return additional non-retail marketplaces. They do not establish
    coverage until their financial identity and time zone are supported. Unknown
    native IDs in actual transaction responses are rejected by preprocessing.
    """
    client: SellersClient | None = None
    try:
        client = cast(
            SellersClient,
            create_explicit_sp_api_client(Sellers, scope.client_marketplace, credentials),
        )
        response = sanitized_throttled_api_call(
            client.get_marketplace_participation,
            safe_error=SellersParticipationRequestError("Sellers marketplace discovery failed."),
        )
        return financial_marketplace_ids(cast(_PayloadResponse, response).payload, scope)
    finally:
        close_quietly(client)


def financial_marketplace_ids(payload: object, scope: AmazonCredentialScope) -> tuple[str, ...]:
    if not isinstance(payload, list):
        raise ValueError("Sellers participation response must contain a list.")
    allowed = set(scope.marketplace_ids) | financial_channel_ids(scope.name)
    participations: dict[str, bool] = {}
    for value in cast(list[object], payload):
        entry = _mapping(value)
        marketplace = _mapping(entry.get("marketplace"))
        participation = _mapping(entry.get("participation"))
        identifier, active = marketplace.get("id"), participation.get("isParticipating")
        if not isinstance(identifier, str) or not identifier.strip() or type(active) is not bool:
            raise ValueError("Sellers participation identity or status is invalid.")
        if identifier not in allowed:
            continue
        previous = participations.get(identifier)
        if previous is not None and previous != active:
            raise ValueError("Sellers returned conflicting financial marketplace participation.")
        participations[identifier] = active
    return tuple(sorted(identifier for identifier, active in participations.items() if active))


def _mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError("Sellers participation must contain objects.")
    return cast(Mapping[str, object], value)
