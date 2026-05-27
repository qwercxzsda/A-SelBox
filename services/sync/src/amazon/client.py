from dataclasses import dataclass

from sp_api.api import Reports
from sp_api.base import Marketplaces

from src.amazon.marketplaces import get_endpoint_marketplaces, validate_endpoint


@dataclass(frozen=True)
class ReportsClientFactory:
    """Store SP-API client settings and create Reports clients on demand."""

    amazon_endpoint: str
    refresh_token: str

    def __post_init__(self) -> None:
        """Validate the exact endpoint code and non-empty refresh token."""
        object.__setattr__(self, "amazon_endpoint", validate_endpoint(self.amazon_endpoint))
        if not self.refresh_token:
            raise ValueError("refresh_token must not be empty.")

    def create(self) -> Reports:
        """Build an SP-API Reports client for this factory's endpoint."""
        # Any marketplace in the endpoint region can initialize the regional Reports client.
        marketplace: Marketplaces = get_endpoint_marketplaces(self.amazon_endpoint)[0]
        return Reports(
            marketplace=marketplace,
            refresh_token=self.refresh_token,
        )
