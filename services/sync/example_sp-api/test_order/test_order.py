import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from sp_api.api import OrdersV20260101
from sp_api.base import ApiResponse, Marketplaces
from sp_api.util import load_all_pages, sp_retry

logger: logging.Logger = logging.getLogger(__name__)

load_dotenv()


if __name__ == "__main__":
    # Set up logging
    fh: logging.FileHandler = logging.FileHandler(
        Path(__file__).parent / f"{datetime.now().strftime('%Y-%m-%dT%H-%M-%S')}.log"
    )
    sh: logging.StreamHandler = logging.StreamHandler()
    logging.basicConfig(
        format="%(asctime)s.%(msecs)03d [%(levelname)s] %(name)s -- %(message)s",
        datefmt="%m/%d/%Y %H:%M:%S",
        level=logging.INFO,
        handlers=[fh, sh],
    )

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

    client: OrdersV20260101 = OrdersV20260101(
        marketplace=Marketplaces.US,
        refresh_token=os.getenv("REFRESH_TOKEN_NA"),
    )

    order: ApiResponse = client.get_order(
        order_id="111-4317264-8817020", included_data=included_data
    )
    logger.info(f"Order: {order}")  # ApiResponse object
    logger.info(f"Order Payload: {order.payload}")  # raw response dict

    @load_all_pages(next_token_param="paginationToken")
    @sp_retry()
    def iter_orders(**kwargs):
        return client.search_orders(**kwargs)

    orders: list[ApiResponse] = list(
        iter_orders(
            lastUpdatedAfter=(datetime.now(UTC) - timedelta(hours=2)).strftime(
                "%Y-%m-%dT%H:%M:%S.%fZ"
            ),
            maxResultsPerPage=1,
            includedData=included_data,
        )
    )
    logger.info(f"Orders: {orders}, {orders[0].payload}")
    i: int = 0
    for page in orders:
        logger.info(f"Page: {page}, {page.payload}")
        for order in page.payload.get("orders", []):
            logger.info(f"{i}th order: {order}")
            i += 1
    logger.info(f"Total orders: {i}")
