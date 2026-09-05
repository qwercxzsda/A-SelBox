from collections.abc import Callable
from typing import cast

from sp_api.api import DataKiosk, Reports
from sp_api.base import Marketplaces

from .credentials import AmazonLwaCredentials
from .data_kiosk.client_protocol import DataKioskClient
from .marketplaces import get_credential_scope
from .transport import ensure_explicit_marketplace_routing


def create_explicit_sp_api_client[ClientT](
    client_class: Callable[..., ClientT],
    marketplace: Marketplaces,
    credentials: AmazonLwaCredentials,
) -> ClientT:
    """Construct an explicitly credentialed client on its intended transport."""
    ensure_explicit_marketplace_routing(marketplace)
    return client_class(
        marketplace=marketplace,
        refresh_token=credentials.refresh_token,
        credentials=credentials.as_sdk_credentials(),
    )


def create_reports_client(
    amazon_scope: str,
    credentials: AmazonLwaCredentials,
) -> Reports:
    """Build an explicitly credentialed Reports client for one scope."""
    marketplace: Marketplaces = get_credential_scope(amazon_scope).client_marketplace
    return create_explicit_sp_api_client(Reports, marketplace, credentials)


def create_data_kiosk_client(
    marketplace: Marketplaces,
    credentials: AmazonLwaCredentials,
) -> DataKioskClient:
    """Build an explicitly credentialed regional Data Kiosk client."""
    # python-amazon-sp-api omits None from the annotation for its optional
    # ``file`` argument. Keep that third-party typing defect at this boundary.
    return cast(
        DataKioskClient,
        create_explicit_sp_api_client(DataKiosk, marketplace, credentials),
    )
