import unittest
from datetime import UTC, datetime
from typing import cast
from unittest.mock import patch

from sp_api.base import Marketplaces, SellingApiRequestThrottledException

from ....src.amazon.fba_reports.lifecycle import (
    FbaReportFailedError,
    FbaReportPollingTimeoutError,
    obtain_fba_report,
    poll_fba_report,
)
from ....src.amazon.fba_reports.listing import list_done_fba_reports, select_covering_report
from ....src.amazon.fba_reports.report_types import FBA_REMOVAL_ORDER_DETAIL_REPORT
from ....src.amazon.reports.errors import ReportResponseError
from ....src.amazon.reports.summaries import DoneReportSummary


class _Response:
    def __init__(
        self,
        payload: dict[str, object],
        next_token: str | None = None,
    ) -> None:
        self.payload = payload
        self.next_token = next_token


class _ReportsClient:
    def __init__(
        self,
        *,
        report_pages: list[_Response] | None = None,
        report_statuses: list[dict[str, object]] | None = None,
    ) -> None:
        self.report_pages = list(report_pages or [])
        self.report_statuses = list(report_statuses or [])
        self.get_reports_calls: list[dict[str, object]] = []
        self.get_report_calls: list[str] = []
        self.create_calls: list[dict[str, object]] = []

    def get_reports(self, **kwargs: object) -> _Response:
        self.get_reports_calls.append(kwargs)
        return self.report_pages.pop(0)

    def create_report(self, **kwargs: object) -> _Response:
        self.create_calls.append(kwargs)
        return _Response({"reportId": "created-report"})

    def get_report(self, report_id: str, **_kwargs: object) -> _Response:
        self.get_report_calls.append(report_id)
        payload = dict(self.report_statuses.pop(0))
        payload.setdefault("reportId", report_id)
        return _Response(payload)


def _done_report(
    report_id: str,
    document_id: str,
    *,
    created_time: str = "2026-08-20T12:00:00Z",
    data_start_time: str = "2026-08-01T00:00:00Z",
    data_end_time: str = "2026-08-16T00:00:00Z",
) -> dict[str, object]:
    return {
        "reportId": report_id,
        "reportDocumentId": document_id,
        "reportType": FBA_REMOVAL_ORDER_DETAIL_REPORT,
        "processingStatus": "DONE",
        "createdTime": created_time,
        "dataStartTime": data_start_time,
        "dataEndTime": data_end_time,
        "marketplaceIds": ["MARKETPLACE1"],
    }


def _throttled(retry_after: str = "1") -> SellingApiRequestThrottledException:
    return SellingApiRequestThrottledException(
        [{"code": "QuotaExceeded", "message": "private request context"}],
        headers={"Retry-After": retry_after},
    )


class TestFbaReportLifecycle(unittest.TestCase):
    def setUp(self) -> None:
        self.start = datetime(2026, 8, 1, tzinfo=UTC)
        self.end = datetime(2026, 8, 15, 23, 59, tzinfo=UTC)
        self.created_since = datetime(2026, 7, 1, tzinfo=UTC)
        self.created_until = datetime(2026, 8, 22, tzinfo=UTC)

    def test_lists_all_pages_and_deduplicates_exact_report_identity(self) -> None:
        client = _ReportsClient(
            report_pages=[
                _Response({"reports": [_done_report("report-1", "document-1")]}, "next"),
                _Response(
                    {
                        "reports": [
                            _done_report("report-1", "document-1"),
                            _done_report(
                                "report-2",
                                "document-2",
                                created_time="2026-08-21T12:00:00Z",
                            ),
                        ]
                    }
                ),
            ]
        )

        reports = list_done_fba_reports(
            client,
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            marketplace_ids=["MARKETPLACE1"],
            created_since=self.created_since,
            created_until=self.created_until,
        )

        self.assertEqual([report.report_id for report in reports], ["report-2", "report-1"])
        self.assertEqual(
            client.get_reports_calls[0]["createdSince"],
            "2026-07-01T00:00:00Z",
        )
        self.assertEqual(
            client.get_reports_calls[0]["createdUntil"],
            "2026-08-22T00:00:00Z",
        )
        self.assertEqual(client.get_reports_calls[1], {"nextToken": "next"})

    def test_duplicate_marketplace_order_is_not_a_metadata_conflict(self) -> None:
        """Treat marketplaceIds as an unordered scope, including across pages."""
        first = _done_report("report-1", "document-1") | {
            "marketplaceIds": ["MARKETPLACE1", "MARKETPLACE2"]
        }
        reordered = first | {"marketplaceIds": ["MARKETPLACE2", "MARKETPLACE1"]}
        client = _ReportsClient(
            report_pages=[
                _Response({"reports": [first]}, "next"),
                _Response({"reports": [reordered]}),
            ]
        )

        reports = list_done_fba_reports(
            client,
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            marketplace_ids=["MARKETPLACE1", "MARKETPLACE2"],
            created_since=self.created_since,
            created_until=self.created_until,
        )

        self.assertEqual(len(reports), 1)

    def test_listing_chunks_more_than_ten_marketplace_ids(self) -> None:
        """Honor the getReports marketplaceIds request limit across countries."""
        marketplace_ids = [f"MARKETPLACE{index}" for index in range(1, 12)]
        client = _ReportsClient(
            report_pages=[
                _Response({"reports": []}),
                _Response({"reports": []}),
            ]
        )

        reports = list_done_fba_reports(
            client,
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            marketplace_ids=marketplace_ids,
            created_since=self.created_since,
            created_until=self.created_until,
        )

        self.assertEqual(reports, ())
        self.assertEqual(
            [len(cast(list[str], call["marketplaceIds"])) for call in client.get_reports_calls],
            [10, 1],
        )

    def test_obtain_retries_list_create_and_status_with_the_injected_sleeper(self) -> None:
        sleep_calls: list[float] = []
        client = _ReportsClient()
        done_response = _Response({"reports": []})
        created_response = _Response({"reportId": "created-report"})
        status_response = _Response(_done_report("created-report", "document-1"))

        with (
            patch.object(
                client,
                "get_reports",
                side_effect=(_throttled(), done_response),
            ),
            patch.object(
                client,
                "create_report",
                side_effect=(_throttled(), created_response),
            ),
            patch.object(
                client,
                "get_report",
                side_effect=(_throttled(), status_response),
            ),
        ):
            report = obtain_fba_report(
                client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                data_start_at=self.start,
                data_end_at=self.end,
                discovery_created_since=self.created_since,
                discovery_created_until=self.created_until,
                max_poll_attempts=1,
                sleep=sleep_calls.append,
            )

        self.assertEqual(report.report_document_id, "document-1")
        self.assertEqual(sleep_calls, [1.0, 1.0, 1.0])

    def test_listing_rejects_report_or_document_identity_collisions(self) -> None:
        collisions = (
            (
                _done_report("report-1", "document-1"),
                _done_report("report-1", "document-2"),
                "report ID",
            ),
            (
                _done_report("report-1", "document-1"),
                _done_report("report-2", "document-1"),
                "document ID",
            ),
        )
        for first, second, message in collisions:
            client = _ReportsClient(report_pages=[_Response({"reports": [first, second]})])
            with (
                self.subTest(message=message),
                self.assertRaisesRegex(RuntimeError, message),
            ):
                list_done_fba_reports(
                    client,
                    report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                    marketplace_ids=["MARKETPLACE1"],
                    created_since=self.created_since,
                    created_until=self.created_until,
                )

    def test_listing_rejects_repeated_tokens_and_exhausted_page_bound(self) -> None:
        repeated_token_client = _ReportsClient(
            report_pages=[
                _Response({"reports": []}, "next"),
                _Response({"reports": []}, "next"),
            ]
        )
        with self.assertRaisesRegex(RuntimeError, "repeated nextToken"):
            list_done_fba_reports(
                repeated_token_client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                created_since=self.created_since,
                created_until=self.created_until,
            )

        bounded_client = _ReportsClient(report_pages=[_Response({"reports": []}, "next")])
        with self.assertRaisesRegex(RuntimeError, "exceeded the configured page bound"):
            list_done_fba_reports(
                bounded_client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                created_since=self.created_since,
                created_until=self.created_until,
                max_pages=1,
            )

    def test_selects_newest_report_covering_requested_data_period(self) -> None:
        client = _ReportsClient(
            report_pages=[
                _Response(
                    {
                        "reports": [
                            _done_report("older", "document-1"),
                            _done_report(
                                "newer",
                                "document-2",
                                created_time="2026-08-21T12:00:00Z",
                            ),
                        ]
                    }
                )
            ]
        )
        reports = list_done_fba_reports(
            client,
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            marketplace_ids=["MARKETPLACE1"],
            created_since=self.created_since,
            created_until=self.created_until,
        )

        selected = select_covering_report(
            reports,
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            marketplace_ids=["MARKETPLACE1"],
            data_start_at=self.start,
            data_end_at=self.end,
        )

        self.assertIsNotNone(selected)
        self.assertEqual(selected.report_id if selected else None, "newer")

    def test_listing_rejects_report_with_marketplace_outside_request(self) -> None:
        multi_market = _done_report("multi", "document-1") | {
            "marketplaceIds": ["MARKETPLACE1", "MARKETPLACE2"]
        }
        client = _ReportsClient(report_pages=[_Response({"reports": [multi_market]})])
        with self.assertRaisesRegex(RuntimeError, "outside the request"):
            list_done_fba_reports(
                client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                created_since=self.created_since,
                created_until=self.created_until,
            )

    def test_listing_accepts_broader_known_report_then_exact_selection_ignores_it(self) -> None:
        us_marketplace_id = cast(str, Marketplaces.US.marketplace_id)
        ca_marketplace_id = cast(str, Marketplaces.CA.marketplace_id)
        broader_report = _done_report("multi", "document-1") | {
            "marketplaceIds": [us_marketplace_id, ca_marketplace_id]
        }
        client = _ReportsClient(report_pages=[_Response({"reports": [broader_report]})])

        reports = list_done_fba_reports(
            client,
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            marketplace_ids=[us_marketplace_id],
            created_since=self.created_since,
            created_until=self.created_until,
        )

        self.assertEqual(len(reports), 1)
        self.assertIsNone(
            select_covering_report(
                reports,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=[us_marketplace_id],
                data_start_at=self.start,
                data_end_at=self.end,
            )
        )

    def test_listing_validates_creation_window_and_ignores_payload_token_fallback(self) -> None:
        """Use the live SDK token property and verify every returned creation time."""
        payload_token_client = _ReportsClient(
            report_pages=[_Response({"reports": [], "nextToken": "payload-only-token"})]
        )
        self.assertEqual(
            list_done_fba_reports(
                payload_token_client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                created_since=self.created_since,
                created_until=self.created_until,
            ),
            (),
        )
        self.assertEqual(len(payload_token_client.get_reports_calls), 1)

        outside = _done_report(
            "report-1",
            "document-1",
            created_time="2026-08-23T00:00:00Z",
        )
        outside_client = _ReportsClient(report_pages=[_Response({"reports": [outside]})])
        with self.assertRaisesRegex(RuntimeError, "creation window"):
            list_done_fba_reports(
                outside_client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                created_since=self.created_since,
                created_until=self.created_until,
            )

    def test_rejects_naive_windows_before_network_calls(self) -> None:
        """Never ask Reports API to interpret an unzoned datetime."""
        client = _ReportsClient()

        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            list_done_fba_reports(
                client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                created_since=datetime(2026, 7, 1),  # noqa: DTZ001 - invalid input
                created_until=self.created_until,
            )
        self.assertEqual(client.get_reports_calls, [])

    def test_redacts_reports_api_transport_failures(self) -> None:
        """Opaque IDs and SDK request details stay out of lifecycle errors."""
        private_context = "private-report-request-context"

        class FailingClient(_ReportsClient):
            def get_reports(self, **_kwargs: object) -> _Response:
                raise RuntimeError(private_context)

        with self.assertRaises(ReportResponseError) as raised:
            list_done_fba_reports(
                FailingClient(),
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                created_since=self.created_since,
                created_until=self.created_until,
            )

        self.assertNotIn(private_context, str(raised.exception))
        self.assertIsNone(raised.exception.__context__)

    def test_obtain_reuses_covering_report_without_creating_one(self) -> None:
        client = _ReportsClient(
            report_pages=[_Response({"reports": [_done_report("existing", "document-1")]})]
        )

        report = obtain_fba_report(
            client,
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            marketplace_ids=["MARKETPLACE1"],
            data_start_at=self.start,
            data_end_at=self.end,
            discovery_created_since=self.created_since,
            discovery_created_until=self.created_until,
        )

        self.assertEqual(report.report_id, "existing")
        self.assertEqual(client.create_calls, [])

    def test_obtain_requests_and_polls_when_no_report_covers_period(self) -> None:
        client = _ReportsClient(
            report_pages=[_Response({"reports": []})],
            report_statuses=[
                {
                    "reportId": "created-report",
                    "reportType": FBA_REMOVAL_ORDER_DETAIL_REPORT,
                    "processingStatus": "IN_PROGRESS",
                },
                _done_report("created-report", "created-document"),
            ],
        )
        sleep_calls: list[float] = []

        report = obtain_fba_report(
            client,
            report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
            marketplace_ids=["MARKETPLACE1"],
            data_start_at=self.start,
            data_end_at=self.end,
            discovery_created_since=self.created_since,
            discovery_created_until=self.created_until,
            max_poll_attempts=2,
            poll_interval_seconds=0.5,
            sleep=sleep_calls.append,
        )

        self.assertIsInstance(report, DoneReportSummary)
        self.assertEqual(report.report_document_id, "created-document")
        self.assertEqual(len(client.create_calls), 1)
        self.assertEqual(sleep_calls, [0.5])

    def test_created_report_with_unexpected_marketplace_scope_is_rejected(self) -> None:
        multi_market = _done_report("created-report", "created-document") | {
            "marketplaceIds": ["MARKETPLACE1", "MARKETPLACE2"]
        }
        client = _ReportsClient(
            report_pages=[_Response({"reports": []})],
            report_statuses=[multi_market],
        )

        with self.assertRaisesRegex(RuntimeError, "marketplace scope"):
            obtain_fba_report(
                client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                data_start_at=self.start,
                data_end_at=self.end,
                discovery_created_since=self.created_since,
                discovery_created_until=self.created_until,
                max_poll_attempts=1,
                poll_interval_seconds=0,
            )

    def test_created_report_with_unexpected_report_type_is_rejected(self) -> None:
        wrong_type = _done_report("created-report", "created-document") | {
            "reportType": "UNEXPECTED_REPORT_TYPE"
        }
        client = _ReportsClient(
            report_pages=[_Response({"reports": []})],
            report_statuses=[wrong_type],
        )

        with self.assertRaisesRegex(RuntimeError, "reportType did not match"):
            obtain_fba_report(
                client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                data_start_at=self.start,
                data_end_at=self.end,
                discovery_created_since=self.created_since,
                discovery_created_until=self.created_until,
                max_poll_attempts=1,
                poll_interval_seconds=0,
            )

    def test_created_report_with_narrower_data_window_is_rejected(self) -> None:
        narrow = _done_report("created-report", "created-document") | {
            "dataEndTime": "2026-08-10T00:00:00Z"
        }
        client = _ReportsClient(
            report_pages=[_Response({"reports": []})],
            report_statuses=[narrow],
        )

        with self.assertRaisesRegex(RuntimeError, "data window"):
            obtain_fba_report(
                client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                data_start_at=self.start,
                data_end_at=self.end,
                discovery_created_since=self.created_since,
                discovery_created_until=self.created_until,
                max_poll_attempts=1,
                poll_interval_seconds=0,
            )

    def test_listing_rejects_report_with_non_done_status(self) -> None:
        client = _ReportsClient(
            report_pages=[
                _Response(
                    {
                        "reports": [
                            _done_report("report-1", "document-1")
                            | {"processingStatus": "IN_PROGRESS"}
                        ]
                    }
                )
            ]
        )

        with self.assertRaisesRegex(RuntimeError, "processing status"):
            list_done_fba_reports(
                client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                created_since=self.created_since,
                created_until=self.created_until,
            )

    def test_freshly_created_cancelled_report_remains_a_failure(self) -> None:
        client = _ReportsClient(
            report_pages=[_Response({"reports": []})],
            report_statuses=[{"processingStatus": "CANCELLED"}],
        )

        with self.assertRaises(FbaReportFailedError) as raised:
            obtain_fba_report(
                client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                data_start_at=self.start,
                data_end_at=self.end,
                discovery_created_since=self.created_since,
                discovery_created_until=self.created_until,
                max_poll_attempts=1,
                poll_interval_seconds=0,
            )

        self.assertEqual(raised.exception.processing_status, "CANCELLED")

    def test_arbitrary_cancelled_report_remains_a_failure(self) -> None:
        client = _ReportsClient(report_statuses=[{"processingStatus": "CANCELLED"}])

        with self.assertRaises(FbaReportFailedError) as raised:
            poll_fba_report(client, "possibly-manual-report", max_attempts=1)

        self.assertEqual(raised.exception.processing_status, "CANCELLED")

    def test_fatal_fresh_report_remains_a_failure(self) -> None:
        client = _ReportsClient(
            report_pages=[_Response({"reports": []})],
            report_statuses=[{"processingStatus": "FATAL"}],
        )

        with self.assertRaises(FbaReportFailedError) as raised:
            obtain_fba_report(
                client,
                report_type=FBA_REMOVAL_ORDER_DETAIL_REPORT,
                marketplace_ids=["MARKETPLACE1"],
                data_start_at=self.start,
                data_end_at=self.end,
                discovery_created_since=self.created_since,
                discovery_created_until=self.created_until,
                max_poll_attempts=1,
                poll_interval_seconds=0,
            )

        self.assertEqual(raised.exception.processing_status, "FATAL")

    def test_polling_timeout_and_terminal_failure_are_explicit(self) -> None:
        sleep_calls: list[float] = []
        pending_client = _ReportsClient(
            report_statuses=[
                {"processingStatus": "IN_QUEUE"},
                {"processingStatus": "IN_PROGRESS"},
            ]
        )
        with self.assertRaises(FbaReportPollingTimeoutError):
            poll_fba_report(
                pending_client,
                "report-1",
                max_attempts=2,
                poll_interval_seconds=5,
                sleep=sleep_calls.append,
            )
        self.assertEqual(pending_client.get_report_calls, ["report-1", "report-1"])
        self.assertEqual(sleep_calls, [5])

        failed_client = _ReportsClient(report_statuses=[{"processingStatus": "FATAL"}])
        sleep_calls.clear()
        with self.assertRaises(FbaReportFailedError) as raised:
            poll_fba_report(failed_client, "report-2", max_attempts=120, sleep=sleep_calls.append)
        self.assertEqual(raised.exception.processing_status, "FATAL")
        self.assertEqual(failed_client.get_report_calls, ["report-2"])
        self.assertEqual(sleep_calls, [])

    def test_polling_rejects_a_mismatched_report_id(self) -> None:
        client = _ReportsClient(
            report_statuses=[
                {
                    "reportId": "different-report",
                    "processingStatus": "IN_PROGRESS",
                }
            ]
        )

        with self.assertRaisesRegex(RuntimeError, "reportId did not match"):
            poll_fba_report(client, "requested-report", max_attempts=1)

    def test_polling_rejects_non_finite_interval_before_calling_amazon(self) -> None:
        client = _ReportsClient()

        with self.assertRaisesRegex(ValueError, "finite and non-negative"):
            poll_fba_report(client, "report-1", poll_interval_seconds=float("nan"))

        self.assertEqual(client.get_report_calls, [])


if __name__ == "__main__":
    unittest.main()
