import logging
import os
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol, cast

import spapi as _spapi
from dotenv import load_dotenv

logger: logging.Logger = logging.getLogger(__name__)


class _SpApiClient(Protocol):
    api_client: object


class _GetOrderApi(Protocol):
    def get_order(self, order_id: str, **kwargs: object) -> object:
        """Get one order through the generated Amazon SDK."""
        ...


class _SearchOrdersApi(Protocol):
    def search_orders(self, **kwargs: object) -> object:
        """Search orders through the generated Amazon SDK."""
        ...


type _ConfigFactory = Callable[..., object]
type _ClientFactory = Callable[[object], _SpApiClient]
type _GetOrderApiFactory = Callable[[object], _GetOrderApi]
type _SearchOrdersApiFactory = Callable[[object], _SearchOrdersApi]

_config_factory: _ConfigFactory = cast(
    _ConfigFactory,
    vars(_spapi)["SPAPIConfig"],
)
_client_factory: _ClientFactory = cast(
    _ClientFactory,
    vars(_spapi)["SPAPIClient"],
)
_get_order_api_factory: _GetOrderApiFactory = cast(
    _GetOrderApiFactory,
    vars(_spapi)["GetOrderApi"],
)
_search_orders_api_factory: _SearchOrdersApiFactory = cast(
    _SearchOrdersApiFactory,
    vars(_spapi)["SearchOrdersApi"],
)


load_dotenv()


if __name__ == "__main__":
    fh: logging.FileHandler = logging.FileHandler(
        Path(__file__).parent / f"{datetime.now(UTC).strftime('%Y-%m-%dT%H-%M-%S')}.log"
    )

    logging.basicConfig(
        format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s -- %(message)s",
        datefmt="%m/%d/%Y %H:%M:%S",
        level=logging.INFO,
        handlers=[fh],
    )

    # LWA credentials configuration
    sp_api_config: object = _config_factory(
        client_id=os.getenv("CLIENT_ID"),
        client_secret=os.getenv("CLIENT_SECRET"),
        refresh_token=os.getenv("REFRESH_TOKEN_NA"),
        region="NA",
        scope=None,
    )
    client: _SpApiClient = _client_factory(sp_api_config)

    included_data: list[str] = [
        "BUYER",
        "RECIPIENT",
        "PROCEEDS",
        "EXPENSE",
        "PROMOTION",
        "CANCELLATION",
        "FULFILLMENT",
        "PACKAGES",
        "TAX",
        "PAYMENT",
    ]

    get_order_api: _GetOrderApi = _get_order_api_factory(client.api_client)
    response: object = get_order_api.get_order(
        order_id="111-4317264-8817020",
        included_data=included_data,
    )
    print(response)

    # Get current UTC time
    now_utc: datetime = datetime.now(UTC)
    # Format with Z suffix
    iso_z: str = (now_utc - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(iso_z)

    search_orders_api: _SearchOrdersApi = _search_orders_api_factory(client.api_client)
    response = search_orders_api.search_orders(
        last_updated_after=iso_z,
        included_data=included_data,
        # fulfillment_statuses=["SHIPPED"],
    )
    print(response)
