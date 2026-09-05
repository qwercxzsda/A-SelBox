"""Tests for Settlement report discovery and audit windows."""

import unittest
from datetime import UTC, datetime
from typing import cast

from sp_api.base import SellingApiException, SellingApiRequestThrottledException

from ....src.amazon.marketplaces import CREDENTIAL_SCOPES
from ....src.amazon.reports.discovery import (
    SETTLEMENT_REPORT_TYPE,
    discover_settlement_reports,
)
from ....src.amazon.reports.errors import ReportResponseError
from ...support.settlement_reports import (
    FakeClient,
    FakePaginatedClient,
    FakeResponse,
    make_report_text,
)

NA_MARKETPLACE_ID = "ATVPDKIKX0DER"
CANADA_MARKETPLACE_ID = "A2EUQ1WTGCTBG2"
JAPAN_MARKETPLACE_ID = "A1VC38T7YXB528"
CREATED_SINCE = datetime(2026, 5, 23, tzinfo=UTC)
CREATED_UNTIL = datetime(2026, 8, 21, tzinfo=UTC)


def _throttled(retry_after: str = "1") -> SellingApiRequestThrottledException:
    return SellingApiRequestThrottledException(
        [{"code": "QuotaExceeded", "message": "private request context"}],
        headers={"Retry-After": retry_after},
    )


class _ScriptedReportsClient:
    def __init__(self, events: list[FakeResponse | Exception]) -> None:
        self.events = list(events)
        self.get_reports_calls: list[dict[str, object]] = []

    def get_reports(self, **kwargs: object) -> FakeResponse:
        self.get_reports_calls.append(kwargs)
        event = self.events.pop(0)
        if isinstance(event, Exception):
            raise event
        return event


class TestSettlementReportDiscovery(unittest.TestCase):
    def test_formats_typed_discovery_window_only_at_the_sdk_boundary(self) -> None:
        client = FakeClient(make_report_text(), reports=[])

        discover_settlement_reports(
            client,
            marketplace_ids=(NA_MARKETPLACE_ID,),
            amazon_scope="NA",
            created_since=CREATED_SINCE,
            created_until=CREATED_UNTIL,
        )

        self.assertEqual(client.get_reports_calls[0]["createdSince"], "2026-05-23T00:00:00Z")
        self.assertEqual(client.get_reports_calls[0]["createdUntil"], "2026-08-21T00:00:00Z")

    def test_accepts_report_at_fractional_second_request_boundary(self) -> None:
        boundary = datetime(2026, 8, 20, 12, 34, 56, 123456, tzinfo=UTC)
        client = FakeClient(
            make_report_text(),
            reports=[
                _report(
                    "report-1",
                    "document-1",
                    "2026-08-20T12:34:56.123456Z",
                    data_start_time="2026-08-01T00:00:00Z",
                    data_end_time="2026-08-15T23:59:59Z",
                )
            ],
        )

        result = discover_settlement_reports(
            client,
            marketplace_ids=(NA_MARKETPLACE_ID,),
            amazon_scope="NA",
            created_since=boundary,
            created_until=boundary,
        )

        self.assertEqual(len(result.reports), 1)
        self.assertEqual(
            result.reports[0].report_data_start_at,
            datetime(2026, 8, 1, tzinfo=UTC),
        )
        self.assertEqual(
            result.reports[0].report_data_end_at,
            datetime(2026, 8, 15, 23, 59, 59, tzinfo=UTC),
        )
        self.assertEqual(
            client.get_reports_calls[0]["createdSince"],
            "2026-08-20T12:34:56.123456Z",
        )

    def test_discovery_chunks_marketplaces_and_deduplicates(self) -> None:
        """Check that endpoints with over ten marketplaces use valid API calls."""
        marketplace_ids = CREDENTIAL_SCOPES["EU"].marketplace_ids
        client = FakeClient(
            make_report_text(),
            reports=[
                _report(
                    "report-1",
                    "document-1",
                    "2026-08-20T12:34:56Z",
                    marketplace_ids=list(marketplace_ids),
                )
            ],
        )

        result = discover_settlement_reports(
            client,
            marketplace_ids=marketplace_ids,
            amazon_scope="EU",
            created_since=CREATED_SINCE,
            created_until=CREATED_UNTIL,
        )

        self.assertEqual(len(client.get_reports_calls), 2)
        requested_marketplace_lists: list[list[object]] = []
        for call in client.get_reports_calls:
            requested_ids = call.get("marketplaceIds")
            if not isinstance(requested_ids, list):
                self.fail("Initial report-list calls must include marketplaceIds.")
            requested_marketplace_lists.append(cast(list[object], requested_ids))
        self.assertTrue(all(len(ids) <= 10 for ids in requested_marketplace_lists))
        self.assertEqual(len(result.reports), 1)
        self.assertEqual(
            result.reports[0].report_created_at,
            datetime(2026, 8, 20, 12, 34, 56, tzinfo=UTC),
        )

    def test_report_response_must_overlap_the_exact_marketplace_chunk(self) -> None:
        """Do not accept a second-chunk identity from the first chunk's response."""
        marketplace_ids = CREDENTIAL_SCOPES["EU"].marketplace_ids
        second_chunk_marketplace_id = marketplace_ids[-1]
        client = FakePaginatedClient(
            [
                FakeResponse(
                    {
                        "reports": [
                            _report(
                                "report-1",
                                "document-1",
                                "2026-08-20T12:34:56Z",
                                marketplace_ids=[second_chunk_marketplace_id],
                            )
                        ]
                    },
                    None,
                ),
                FakeResponse({"reports": []}, None),
            ]
        )

        with self.assertRaisesRegex(ValueError, "outside the request marketplace scope"):
            discover_settlement_reports(
                client,
                marketplace_ids=marketplace_ids,
                amazon_scope="EU",
                created_since=CREATED_SINCE,
                created_until=CREATED_UNTIL,
            )

        self.assertEqual(len(client.get_reports_calls), 1)

    def test_cross_chunk_duplicate_identity_quarantines_conflicting_created_time(
        self,
    ) -> None:
        """Quarantine the identity regardless of which chunk returns either summary first."""
        created_times = (
            "2026-08-20T10:00:00Z",
            "2026-08-20T11:00:00Z",
        )
        scope_marketplace_ids = CREDENTIAL_SCOPES["EU"].marketplace_ids
        cross_chunk_marketplace_ids = [scope_marketplace_ids[0], scope_marketplace_ids[-1]]

        for first_created_time, second_created_time in (
            created_times,
            tuple(reversed(created_times)),
        ):
            with self.subTest(first_created_time=first_created_time):
                client = FakePaginatedClient(
                    [
                        FakeResponse(
                            {
                                "reports": [
                                    _report(
                                        "report-1",
                                        "document-1",
                                        first_created_time,
                                        marketplace_ids=cross_chunk_marketplace_ids,
                                    )
                                ]
                            },
                            None,
                        ),
                        FakeResponse(
                            {
                                "reports": [
                                    _report(
                                        "report-1",
                                        "document-1",
                                        second_created_time,
                                        marketplace_ids=cross_chunk_marketplace_ids,
                                    )
                                ]
                            },
                            None,
                        ),
                    ]
                )

                with self.assertLogs(
                    "services.sync.src.amazon.reports.discovery",
                    level="ERROR",
                ) as captured_logs:
                    result = discover_settlement_reports(
                        client,
                        marketplace_ids=CREDENTIAL_SCOPES["EU"].marketplace_ids,
                        amazon_scope="EU",
                        created_since=CREATED_SINCE,
                        created_until=CREATED_UNTIL,
                    )

                self.assertEqual(result.reports, ())
                self.assertEqual(result.identity_anomaly_count, 1)
                self.assertEqual(result.listed_count, 1)
                self.assertEqual(len(client.get_reports_calls), 2)
                logs = "\n".join(captured_logs.output)
                self.assertIn("identity anomalies", logs)
                self.assertNotIn("report-1", logs)
                self.assertNotIn("document-1", logs)

    def test_discovery_paginates_with_next_token_only(self) -> None:
        """Check bounded explicit pagination across two Reports API pages."""
        client = FakePaginatedClient(
            [
                FakeResponse(
                    {
                        "reports": [
                            _report(
                                "report-1",
                                "document-1",
                                "2026-08-20T11:00:00Z",
                                marketplace_ids=[JAPAN_MARKETPLACE_ID],
                            )
                        ]
                    },
                    "next-page",
                ),
                FakeResponse(
                    {
                        "reports": [
                            _report(
                                "report-2",
                                "document-2",
                                "2026-08-20T12:00:00Z",
                                marketplace_ids=[JAPAN_MARKETPLACE_ID],
                            )
                        ]
                    },
                    None,
                ),
            ]
        )

        result = discover_settlement_reports(
            client,
            marketplace_ids=[JAPAN_MARKETPLACE_ID],
            amazon_scope="JAPAN",
            created_since=CREATED_SINCE,
            created_until=CREATED_UNTIL,
        )

        self.assertEqual(len(result.reports), 2)
        self.assertEqual(client.get_reports_calls[1], {"nextToken": "next-page"})

    def test_discovery_retries_explicit_429_then_continues_pagination(self) -> None:
        """Honor Retry-After without changing the request that was throttled."""
        first_page = FakeResponse(
            {"reports": [_report("report-1", "document-1", "2026-08-20T11:00:00Z")]},
            "next-page",
        )
        client = _ScriptedReportsClient(
            [_throttled("7"), first_page, FakeResponse({"reports": []}, None)]
        )
        sleeps: list[float] = []

        result = discover_settlement_reports(
            client,
            marketplace_ids=[NA_MARKETPLACE_ID],
            amazon_scope="NA",
            created_since=CREATED_SINCE,
            created_until=CREATED_UNTIL,
            sleep=sleeps.append,
        )

        self.assertEqual([report.report_id for report in result.reports], ["report-1"])
        self.assertEqual(sleeps, [7.0])
        self.assertEqual(client.get_reports_calls[0], client.get_reports_calls[1])
        self.assertEqual(client.get_reports_calls[2], {"nextToken": "next-page"})

    def test_discovery_sanitizes_permanent_failures_without_retrying(self) -> None:
        """Permanent SDK and transport errors fail safely after one request."""
        private_context = "private marketplace and authorization context"
        headers: dict[str, str] = {}
        errors = (
            SellingApiException(
                [{"code": "Unauthorized", "message": private_context}],
                headers=headers,
            ),
            RuntimeError(private_context),
        )

        for error in errors:
            with self.subTest(error_type=type(error).__name__):
                client = _ScriptedReportsClient([error, FakeResponse({"reports": []}, None)])
                sleeps: list[float] = []

                with self.assertRaises(ReportResponseError) as raised:
                    discover_settlement_reports(
                        client,
                        marketplace_ids=[NA_MARKETPLACE_ID],
                        amazon_scope="NA",
                        created_since=CREATED_SINCE,
                        created_until=CREATED_UNTIL,
                        sleep=sleeps.append,
                    )

                self.assertEqual(len(client.get_reports_calls), 1)
                self.assertEqual(sleeps, [])
                self.assertNotIn(private_context, repr(raised.exception))
                self.assertIsNone(raised.exception.__context__)

    def test_discovery_quarantines_all_report_or_document_identity_collisions(
        self,
    ) -> None:
        """Exclude every report involved in a non-one-to-one identity."""
        collisions = (
            (
                _report("report-1", "document-1", "2026-08-20T10:00:00Z"),
                _report("report-1", "document-2", "2026-08-20T10:00:00Z"),
                1,
            ),
            (
                _report("report-1", "document-1", "2026-08-20T10:00:00Z"),
                _report("report-2", "document-1", "2026-08-20T10:00:00Z"),
                2,
            ),
        )

        for first, second, expected_anomaly_count in collisions:
            client = FakePaginatedClient([FakeResponse({"reports": [first, second]}, None)])
            with self.subTest(expected_anomaly_count=expected_anomaly_count):
                with self.assertLogs(
                    "services.sync.src.amazon.reports.discovery",
                    level="ERROR",
                ) as captured_logs:
                    result = discover_settlement_reports(
                        client,
                        marketplace_ids=[NA_MARKETPLACE_ID],
                        amazon_scope="NA",
                        created_since=CREATED_SINCE,
                        created_until=CREATED_UNTIL,
                    )

                self.assertEqual(result.reports, ())
                self.assertEqual(
                    result.identity_anomaly_count,
                    expected_anomaly_count,
                )
                self.assertEqual(result.listed_count, expected_anomaly_count)
                logs = "\n".join(captured_logs.output)
                for raw_identity in ("report-1", "report-2", "document-1", "document-2"):
                    self.assertNotIn(raw_identity, logs)

    def test_discovery_quarantines_conflicting_metadata_for_one_report_id(self) -> None:
        """Do not keep a marketplace metadata conflict as a duplicate."""
        first = _report("report-1", "document-1", "2026-08-20T10:00:00Z")
        second = first | {"marketplaceIds": [NA_MARKETPLACE_ID, CANADA_MARKETPLACE_ID]}
        client = FakePaginatedClient([FakeResponse({"reports": [first, second]}, None)])

        with self.assertLogs(
            "services.sync.src.amazon.reports.discovery",
            level="ERROR",
        ):
            result = discover_settlement_reports(
                client,
                marketplace_ids=[NA_MARKETPLACE_ID, CANADA_MARKETPLACE_ID],
                amazon_scope="NA",
                created_since=CREATED_SINCE,
                created_until=CREATED_UNTIL,
            )

        self.assertEqual(result.reports, ())
        self.assertEqual(result.identity_anomaly_count, 1)
        self.assertEqual(result.listed_count, 1)

    def test_discovery_rejects_repeated_next_token(self) -> None:
        """Check that a broken pagination cycle cannot loop indefinitely."""
        client = FakePaginatedClient(
            [
                FakeResponse({"reports": []}, "repeated-page"),
                FakeResponse({"reports": []}, "repeated-page"),
            ]
        )

        with self.assertRaisesRegex(RuntimeError, "repeated nextToken"):
            discover_settlement_reports(
                client,
                marketplace_ids=[JAPAN_MARKETPLACE_ID],
                amazon_scope="JAPAN",
                created_since=CREATED_SINCE,
                created_until=CREATED_UNTIL,
            )

    def test_blank_pagination_token_stops_before_another_request(self) -> None:
        for next_token in ("", " ", "\t"):
            with self.subTest(next_token=repr(next_token)):
                client = FakePaginatedClient([FakeResponse({"reports": []}, next_token)])
                with self.assertRaisesRegex(RuntimeError, "invalid nextToken"):
                    discover_settlement_reports(
                        client,
                        marketplace_ids=[JAPAN_MARKETPLACE_ID],
                        amazon_scope="JAPAN",
                        created_since=CREATED_SINCE,
                        created_until=CREATED_UNTIL,
                    )
                self.assertEqual(len(client.get_reports_calls), 1)

    def test_discovery_rejects_noncontract_payloads_and_non_done_reports(self) -> None:
        invalid_payloads: tuple[dict[str, object], ...] = (
            {"reports": {}},
            {"reports": [None]},
            {
                "reports": [
                    _report(
                        "report-1",
                        "document-1",
                        "2026-08-20T10:00:00Z",
                        processing_status="IN_PROGRESS",
                    )
                ]
            },
        )

        for payload in invalid_payloads:
            with self.subTest(payload_type=type(payload["reports"]).__name__):
                client = FakePaginatedClient([FakeResponse(payload, None)])
                with self.assertRaises(ValueError):
                    discover_settlement_reports(
                        client,
                        marketplace_ids=[NA_MARKETPLACE_ID],
                        amazon_scope="NA",
                        created_since=CREATED_SINCE,
                        created_until=CREATED_UNTIL,
                    )

    def test_accepts_broader_returned_settlement_marketplace_metadata(self) -> None:
        """Keep the multi-market Settlement summary shape observed live."""
        client = FakePaginatedClient(
            [
                FakeResponse(
                    {
                        "reports": [
                            _report(
                                "report-1",
                                "document-1",
                                "2026-08-20T10:00:00Z",
                                marketplace_ids=[NA_MARKETPLACE_ID, "outside-request"],
                            )
                        ]
                    },
                    None,
                )
            ]
        )

        result = discover_settlement_reports(
            client,
            marketplace_ids=[NA_MARKETPLACE_ID],
            amazon_scope="NA",
            created_since=CREATED_SINCE,
            created_until=CREATED_UNTIL,
        )

        self.assertEqual(len(result.reports), 1)

    def test_rejects_report_outside_the_requested_creation_window(self) -> None:
        """Validate returned creation timestamps instead of trusting endpoint filters."""
        client = FakePaginatedClient(
            [
                FakeResponse(
                    {"reports": [_report("report-1", "document-1", "2026-08-22T00:00:01Z")]},
                    None,
                )
            ]
        )

        with self.assertRaisesRegex(ValueError, "outside the requested creation window"):
            discover_settlement_reports(
                client,
                marketplace_ids=[NA_MARKETPLACE_ID],
                amazon_scope="NA",
                created_since=datetime(2026, 8, 1, tzinfo=UTC),
                created_until=datetime(2026, 8, 22, tzinfo=UTC),
            )

    def test_rejects_naive_discovery_window_before_calling_amazon(self) -> None:
        """Reports API date-time boundaries must always carry a timezone."""
        client = FakePaginatedClient([])

        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            discover_settlement_reports(
                client,
                marketplace_ids=[NA_MARKETPLACE_ID],
                amazon_scope="NA",
                created_since=datetime(2026, 8, 1),  # noqa: DTZ001
                created_until=datetime(2026, 8, 22, tzinfo=UTC),
            )

        self.assertEqual(client.get_reports_calls, [])


def _report(
    report_id: str,
    document_id: str,
    created_time: str,
    *,
    processing_status: str = "DONE",
    marketplace_ids: list[str] | None = None,
    data_start_time: str | None = None,
    data_end_time: str | None = None,
) -> dict[str, object]:
    return {
        "reportId": report_id,
        "reportDocumentId": document_id,
        "createdTime": created_time,
        "reportType": SETTLEMENT_REPORT_TYPE,
        "processingStatus": processing_status,
        "marketplaceIds": marketplace_ids or [NA_MARKETPLACE_ID],
        "dataStartTime": data_start_time,
        "dataEndTime": data_end_time,
    }


if __name__ == "__main__":
    unittest.main()
