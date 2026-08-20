import logging
import os
import sys
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol, TextIO, TypedDict, cast

import sp_api.util as _sp_api_util
from dotenv import load_dotenv
from sp_api.api import OrdersV20260101
from sp_api.base import ApiResponse, Marketplaces

logger: logging.Logger = logging.getLogger(__name__)

PAGE_CURSOR_FIELD: str = "paginationToken"

type _ApiResponseCallable = Callable[..., ApiResponse]
type _PaginatedApiResponseCallable = Callable[..., Iterable[ApiResponse]]
type _ApiResponseDecorator = Callable[[_ApiResponseCallable], _ApiResponseCallable]
type _PaginationDecorator = Callable[[_ApiResponseCallable], _PaginatedApiResponseCallable]
type _LoadAllPagesFactory = Callable[..., _PaginationDecorator]
type _RetryFactory = Callable[[], _ApiResponseDecorator]


class _OrdersPayload(TypedDict, total=False):
    orders: list[object]


class _ResponsePayload(Protocol):
    payload: object


class _OrdersPage(Protocol):
    payload: _OrdersPayload


class _TypedOrdersClient(Protocol):
    def get_order(self, order_id: str, **kwargs: object) -> ApiResponse:
        """Get one order from the dynamically typed SDK boundary."""
        ...

    def search_orders(self, **kwargs: object) -> ApiResponse:
        """Search orders through the dynamically typed SDK boundary."""
        ...


# python-amazon-sp-api does not fully annotate its decorator factories. Cast
# them once at the SDK boundary so unknown types do not leak into this example.
_load_all_pages: _LoadAllPagesFactory = cast(
    _LoadAllPagesFactory,
    vars(_sp_api_util)["load_all_pages"],
)
_sp_retry: _RetryFactory = cast(
    _RetryFactory,
    vars(_sp_api_util)["sp_retry"],
)

load_dotenv()


if __name__ == "__main__":
    # Set up logging
    fh: logging.FileHandler = logging.FileHandler(
        Path(__file__).parent / f"{datetime.now(UTC).strftime('%Y-%m-%dT%H-%M-%S')}.log"
    )
    sh: logging.StreamHandler[TextIO] = logging.StreamHandler(sys.stderr)
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
    typed_client: _TypedOrdersClient = cast(_TypedOrdersClient, client)

    order: ApiResponse = typed_client.get_order(
        order_id="111-4317264-8817020", includedData=included_data
    )
    typed_order: _ResponsePayload = cast(_ResponsePayload, order)
    logger.info("Order: %s", order)  # ApiResponse object
    logger.info("Order payload: %s", typed_order.payload)  # raw response object

    def fetch_orders_page(**kwargs: object) -> ApiResponse:
        """Fetch one page of orders with the supplied search parameters."""
        return typed_client.search_orders(**kwargs)

    iter_orders: _PaginatedApiResponseCallable = _load_all_pages(
        next_token_param=PAGE_CURSOR_FIELD,
    )(_sp_retry()(fetch_orders_page))
    orders: list[ApiResponse] = list(
        iter_orders(
            lastUpdatedAfter=(datetime.now(UTC) - timedelta(hours=2)).strftime(
                "%Y-%m-%dT%H:%M:%S.%fZ"
            ),
            maxResultsPerPage=1,
            includedData=included_data,
        )
    )
    first_page: _OrdersPage = cast(_OrdersPage, orders[0])
    logger.info("Orders: %s, %s", orders, first_page.payload)
    i: int = 0
    for page in orders:
        typed_page: _OrdersPage = cast(_OrdersPage, page)
        logger.info("Page: %s, %s", page, typed_page.payload)
        for order_payload in typed_page.payload.get("orders", []):
            logger.info("Order %s: %s", i, order_payload)
            i += 1
    logger.info("Total orders: %s", i)
