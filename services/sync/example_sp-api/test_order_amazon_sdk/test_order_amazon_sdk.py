import logging
import os
from datetime import UTC, datetime, timedelta
from logging import config
from pathlib import Path

from dotenv import load_dotenv
from spapi import GetOrderApi, SearchOrdersApi, SPAPIClient, SPAPIConfig

logger: logging.Logger = logging.getLogger(__name__)

load_dotenv()


if __name__ == "__main__":
    fh: logging.FileHandler = logging.FileHandler(
        Path(__file__) / f"{datetime.now().strftime('%Y-%m-%dT%H-%M-%S')}.log"
    )

    logging.basicConfig(
        format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s -- %(message)s",
        datefmt="%m/%d/%Y %H:%M:%S",
        level=logging.INFO,
    )

    # LWA credentials configuration
    config = SPAPIConfig(
        client_id=os.getenv("CLIENT_ID"),
        client_secret=os.getenv("CLIENT_SECRET"),
        refresh_token=os.getenv("REFRESH_TOKEN_NA"),
        region="NA",
        scope=None,
    )
    # Create the API client with configuration
    client = SPAPIClient(config)

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

    # Call the API operation
    get_order_api = GetOrderApi(client.api_client)
    response = get_order_api.get_order(
        order_id="111-4317264-8817020",
        included_data=included_data,
    )
    print(response)

    # Get current UTC time
    now_utc: datetime = datetime.now(UTC)
    # Format with Z suffix
    iso_z: str = (now_utc - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(iso_z)

    # Call the API operation
    search_orders_api = SearchOrdersApi(client.api_client)
    response = search_orders_api.search_orders(
        last_updated_after=iso_z,
        included_data=included_data,
        # fulfillment_statuses=["SHIPPED"],
    )
    print(response)
