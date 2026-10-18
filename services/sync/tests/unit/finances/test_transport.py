"""Raw Finances transport keeps precision and sanitizes private HTTP failures."""

import gzip
import unittest
from unittest.mock import Mock, patch

import httpx

from services.sync.src.amazon.credentials import AmazonLwaCredentials
from services.sync.src.amazon.finances.client import FinancesHttpClient, FinancesRequestError

MODULE = "services.sync.src.amazon.finances.client"
CREDENTIALS = AmazonLwaCredentials("app", "secret", "refresh")


class TransportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.auth = Mock(headers={"x-amz-access-token": "private-access-token"})
        self.enterContext(patch(MODULE + ".create_explicit_sp_api_client", return_value=self.auth))

    def test_preserves_decoded_source_bytes_and_does_not_add_marketplace(self) -> None:
        content = b'{ "payload" : { "transactions" : [], "exact" : 1234567890.123456789 } }'
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                200,
                content=gzip.compress(content),
                headers={"content-encoding": "gzip", "x-amzn-requestid": "request-1"},
            )

        client = FinancesHttpClient("JAPAN", CREDENTIALS, transport=httpx.MockTransport(respond))
        self.addCleanup(client.close)
        response = client.get_page("transactions", {"postedAfter": "2026-08-01T00:00:00Z"})
        self.assertEqual(response.content, content)
        self.assertEqual(response.request_id, "request-1")
        self.assertEqual(requests[0].url.host, "sellingpartnerapi-fe.amazon.com")
        self.assertEqual(dict(requests[0].url.params), {"postedAfter": "2026-08-01T00:00:00Z"})

    def test_private_error_body_and_token_are_not_exposed(self) -> None:
        def respond(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(403, content=b"private seller account data")

        client = FinancesHttpClient("NA", CREDENTIALS, transport=httpx.MockTransport(respond))
        self.addCleanup(client.close)
        with self.assertRaises(FinancesRequestError) as caught:
            client.get_page("summary", {"periodStart": "2026-08-01"})
        self.assertNotIn("private", str(caught.exception))
        self.assertIsNone(caught.exception.__context__)

    def test_retries_throttles_with_same_request_and_bounded_attempts(self) -> None:
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(429, headers={"retry-after": "1"})

        sleep = Mock()
        client = FinancesHttpClient(
            "EU", CREDENTIALS, transport=httpx.MockTransport(respond), sleep=sleep
        )
        self.addCleanup(client.close)
        with self.assertRaises(FinancesRequestError):
            client.get_page("transactions", {"postedAfter": "2026-08-01T00:00:00Z"})
        self.assertEqual(len(requests), 3)
        self.assertEqual(len({str(request.url) for request in requests}), 1)
        self.assertTrue(any(call.args == (1.0,) for call in sleep.call_args_list))
