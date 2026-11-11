"""Acquisition boundaries preserve raw evidence and never publish partial coverage."""

import unittest
from collections.abc import Mapping
from datetime import UTC, date, datetime
from unittest.mock import patch

from services.sync.src.amazon.finances.client import FinancesOperation, FinancesResponse
from services.sync.src.archives.storage import load_document_archive
from services.sync.src.finances.acquisition import download_finances_acquisition
from services.sync.src.finances.acquisition_models import (
    FinancesAcquisition,
    FinancesCoverageMarketplace,
)
from services.sync.src.finances.acquisition_serialization import (
    finances_acquisition_from_payload,
    finances_acquisition_payload,
)
from services.sync.src.finances.query_windows import (
    reconciliation_interval,
    transaction_query_parameters,
)

MODULE = "services.sync.src.finances.acquisition"
US = FinancesCoverageMarketplace("ATVPDKIKX0DER", "Amazon.com", "America/Los_Angeles")
NOW = datetime(2026, 10, 14, 12, tzinfo=UTC)


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put(self, bucket: str, object_path: str, content: bytes) -> None:
        self.objects[bucket, object_path] = content

    def get(self, bucket: str, object_path: str) -> bytes:
        return self.objects[bucket, object_path]


class FakeClient:
    def __init__(self, transactions: list[bytes], summaries: list[bytes] | None = None) -> None:
        self.pages = {"transactions": iter(transactions), "summary": iter(summaries or [])}
        self.requests: list[tuple[str, dict[str, str]]] = []

    def get_page(
        self, operation: FinancesOperation, parameters: Mapping[str, str]
    ) -> FinancesResponse:
        self.requests.append((operation, dict(parameters)))
        return FinancesResponse(next(self.pages[operation]), NOW, NOW, "request-id")


class AcquisitionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.enterContext(patch(MODULE + ".datetime")).now.return_value = NOW
        self.storage = MemoryStorage()

    def download(self, client: FakeClient, *, max_pages: int = 1000) -> FinancesAcquisition:
        result = download_finances_acquisition(
            client,
            self.storage,
            seller_namespace="seller",
            amazon_scope="NA",
            marketplaces=(US,),
            posted_after=datetime(2026, 8, 1, 7, tzinfo=UTC),
            posted_before=datetime(2026, 9, 1, 7, tzinfo=UTC),
            max_pages=max_pages,
        )
        self.assertIsInstance(result, FinancesAcquisition)
        return result

    def test_raw_decimal_bytes_preserved_and_empty_page_does_not_end_pagination(self) -> None:
        first = b'{"payload":{"transactions":[],"nextToken":"continue"}}'
        second = (
            b'{"payload":{"transactions":[{"totalAmount":'
            b'{"currencyAmount":123456789012345.6789}}]}}'
        )
        client = FakeClient([first, second], [b'{"summaries":[]}'])
        acquisition = self.download(client)
        self.assertEqual(len(acquisition.documents), 3)
        self.assertEqual(
            load_document_archive(self.storage, acquisition.documents[1].document), second
        )
        self.assertEqual(client.requests[1][1], {**client.requests[0][1], "nextToken": "continue"})
        self.assertNotIn("marketplaceId", client.requests[0][1])
        self.assertNotIn("transactionStatus", client.requests[0][1])
        self.assertTrue(acquisition.api_metadata["summary_available"])
        self.assertEqual(
            finances_acquisition_from_payload(finances_acquisition_payload(acquisition)),
            acquisition,
        )

    def test_loop_does_not_publish_and_retains_raw_evidence(self) -> None:
        raw = b'{"payload":{"transactions":[],"nextToken":"repeat"}}'
        with self.assertRaisesRegex(ValueError, "repeated"):
            self.download(FakeClient([raw, raw]))
        self.assertEqual(len(self.storage.objects), 1)

    def test_page_limit_does_not_publish(self) -> None:
        with self.assertRaisesRegex(ValueError, "page limit"):
            self.download(
                FakeClient([b'{"payload":{"transactions":[],"nextToken":"more"}}']), max_pages=1
            )

    def test_malformed_success_is_archived_but_never_published(self) -> None:
        with self.assertRaises(ValueError):
            self.download(FakeClient([b"not JSON"]))
        self.assertEqual(len(self.storage.objects), 1)

    def test_missing_summary_is_explicit_and_partial_summary_pages_are_not_published(self) -> None:
        acquisition = self.download(
            FakeClient(
                [b'{"payload":{"transactions":[]}}'], [b'{"summaries":[],"nextToken":"more"}']
            )
        )
        self.assertFalse(acquisition.api_metadata["summary_available"])
        self.assertEqual([page.operation for page in acquisition.documents], ["transactions"])
        self.assertEqual(len(self.storage.objects), 2)

    def test_empty_result_preserves_its_complete_request_manifest(self) -> None:
        acquisition = self.download(
            FakeClient([b'{"payload":{"transactions":[]}}'], [b'{"summaries":[]}'])
        )
        self.assertTrue(acquisition.documents[0].is_terminal)
        self.assertEqual(acquisition.reconciliation_start_date, date(2026, 8, 1))
        self.assertEqual(acquisition.reconciliation_end_date, date(2026, 8, 31))

    def test_live_summary_envelope_is_supported_without_rewriting_archive(self) -> None:
        summary = b'{"payload":{"summaries":[]},"statusCode":200}'
        acquisition = self.download(FakeClient([b'{"payload":{"transactions":[]}}'], [summary]))
        self.assertTrue(acquisition.api_metadata["summary_available"])
        self.assertEqual(
            load_document_archive(self.storage, acquisition.documents[-1].document), summary
        )

    def test_rolling_pagination_keeps_end_omitted_and_fetches_separate_summary(self) -> None:
        client = FakeClient(
            [
                b'{"payload":{"transactions":[],"nextToken":"continue"}}',
                b'{"payload":{"transactions":[]}}',
            ],
            [b'{"summaries":[]}'],
        )
        acquisition = download_finances_acquisition(
            client,
            self.storage,
            seller_namespace="seller",
            amazon_scope="NA",
            marketplaces=(US,),
            posted_after=datetime(2026, 8, 14, tzinfo=UTC),
        )
        self.assertIsNone(acquisition.posted_before)
        self.assertTrue(
            all("postedBefore" not in p for op, p in client.requests if op == "transactions")
        )
        self.assertEqual(client.requests[1][1], {**client.requests[0][1], "nextToken": "continue"})
        self.assertEqual(
            client.requests[-1],
            ("summary", {"periodStart": "2026-08-14", "periodEnd": "2026-10-13"}),
        )

    def test_partial_day_capture_makes_no_summary_request(self) -> None:
        client = FakeClient([b'{"payload":{"transactions":[]}}'])
        acquisition = download_finances_acquisition(
            client,
            self.storage,
            seller_namespace="seller",
            amazon_scope="NA",
            marketplaces=(US,),
            posted_after=NOW.replace(hour=10),
        )
        self.assertEqual(len(client.requests), 1)
        self.assertIsNone(acquisition.reconciliation_start_date)
        self.assertIsNone(acquisition.reconciliation_end_date)
        self.assertFalse(acquisition.api_metadata["summary_available"])


class QueryWindowTests(unittest.TestCase):
    def test_rolling_request_omits_end_and_spans_months(self) -> None:
        self.assertEqual(
            transaction_query_parameters(datetime(2026, 8, 14, tzinfo=UTC), observed_at=NOW),
            {"postedAfter": "2026-08-14T00:00:00+00:00"},
        )

    def test_reconciliation_uses_only_common_complete_days_and_accounts_for_dst(self) -> None:
        japan = FinancesCoverageMarketplace("A1VC38T7YXB528", "Amazon.co.jp", "Asia/Tokyo")
        self.assertEqual(
            reconciliation_interval(
                (US, japan),
                datetime(2026, 3, 1, tzinfo=UTC),
                datetime(2026, 4, 1, 7, tzinfo=UTC),
                observed_at=NOW,
            ),
            (date(2026, 3, 2), date(2026, 3, 31)),
        )

    def test_partial_current_day_is_allowed_without_whole_day_reconciliation(self) -> None:
        after = NOW.replace(hour=10)
        self.assertEqual(
            transaction_query_parameters(after, observed_at=NOW), {"postedAfter": after.isoformat()}
        )
        self.assertEqual(reconciliation_interval((US,), after, None, observed_at=NOW), (None, None))

    def test_default_upper_bound_is_conservative_capture_start_minus_two_minutes(self) -> None:
        capture = datetime(2026, 11, 11, 8, 1, tzinfo=UTC)
        self.assertEqual(
            reconciliation_interval(
                (US,),
                datetime(2026, 10, 1, tzinfo=UTC),
                None,
                observed_at=capture,
            ),
            (date(2026, 10, 1), date(2026, 11, 9)),
        )

    def test_recent_future_reversed_overlong_and_unavailable_bounds_are_rejected(self) -> None:
        for after, before in (
            (NOW, None),
            (NOW.replace(minute=59), None),
            (datetime(2026, 8, 1, tzinfo=UTC), NOW),
            (datetime(2026, 8, 2, tzinfo=UTC), datetime(2026, 8, 1, tzinfo=UTC)),
            (datetime(2026, 1, 1, tzinfo=UTC), None),
            (datetime(2024, 10, 13, tzinfo=UTC), datetime(2024, 10, 14, tzinfo=UTC)),
        ):
            with self.subTest(after=after, before=before), self.assertRaises(ValueError):
                transaction_query_parameters(after, before, observed_at=NOW)
