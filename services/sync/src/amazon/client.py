from collections.abc import Callable

from sp_api.base import Marketplaces

from .credentials import AmazonLwaCredentials
from .transport import ensure_explicit_marketplace_routing, suppress_sensitive_transport_logging


def create_explicit_sp_api_client[ClientT](
    client_class: Callable[..., ClientT],
    marketplace: Marketplaces,
    credentials: AmazonLwaCredentials,
) -> ClientT:
    """Construct an explicitly credentialed client on its intended transport."""
    suppress_sensitive_transport_logging()
    ensure_explicit_marketplace_routing(marketplace)
    return client_class(
        marketplace=marketplace,
        refresh_token=credentials.refresh_token,
        credentials=credentials.as_sdk_credentials(),
    )
