"""European non-retail activity shares retail Summary controls, not native identities."""

import json
import unittest
from dataclasses import asdict, replace
from datetime import datetime, time, timedelta
from typing import cast
from zoneinfo import ZoneInfo

from services.sync.src.archives.storage import archive_document
from services.sync.src.finances.acquisition_models import ArchivedFinancesPage, FinancesAcquisition
from services.sync.src.finances.marketplaces import coverage_marketplaces
from services.sync.src.finances.models import PreparedFinances
from services.sync.src.finances.preprocess import prepare_finances_acquisition
from services.sync.src.finances.query_windows import transaction_query_parameters
from services.sync.src.finances.validation import validate_finances_candidate
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.finances import finances_acquisition, native_transaction

CHANNELS = (
    ("A1PA6795UKMFR9", "Amazon.de", "A38D8NSA03LJTC", "Non-Amazon DE", "769.37", "-7.36", "762.01"),
    ("APJ6JRA9NG5V4", "Amazon.it", "A62U237T8HV6N", "Non-Amazon IT", "583.74", "-11.48", "572.26"),
)


def candidate(
    retail_id: str,
    channel_id: str,
    retail_amount: str,
    channel_amount: str,
    summary_amount: str,
    *,
    empty: bool = False,
) -> tuple[FinancesAcquisition, PreparedFinances]:
    storage = MemoryArchiveStorage()
    rows: list[dict[str, object]] = []
    if not empty:
        for identifier, amount in ((retail_id, retail_amount), (channel_id, channel_amount)):
            row = native_transaction(identifier, amount=amount, status="RELEASED")
            cast(dict[str, object], row["sellingPartnerMetadata"])["marketplaceId"] = identifier
            cast(dict[str, object], row["totalAmount"])["currencyCode"] = "EUR"
            rows.append(row)
    acquisition = finances_acquisition(storage, rows)
    markets = coverage_marketplaces("EU", (retail_id, channel_id))
    start, end = acquisition.reconciliation_start_date, acquisition.reconciliation_end_date
    if start is None or end is None:
        raise ValueError("Fixture requires a reconciliation interval")
    zone = ZoneInfo(markets[0].time_zone)
    after = datetime.combine(start, time.min, zone)
    before = datetime.combine(end + timedelta(days=1), time.min, zone)
    parameters = transaction_query_parameters(
        after, before, observed_at=acquisition.capture_started_at
    )
    summary = {
        "partnerMetadata": {
            "partnerId": "seller-api",
            "marketplaceId": retail_id,
            "accountType": "STANDARD_ORDERS",
        },
        "periodStart": start.isoformat(),
        "periodEnd": end.isoformat(),
        "netProceeds": {"currencyCode": "EUR", "currencyAmount": summary_amount},
    }
    summary_page = ArchivedFinancesPage(
        operation="summary",
        page_number=1,
        marketplace_id=None,
        is_terminal=True,
        request_parameters={
            "periodStart": start.isoformat(),
            "periodEnd": end.isoformat(),
        },
        requested_at=acquisition.capture_started_at,
        received_at=acquisition.downloaded_at,
        document=archive_document(
            storage, json.dumps({"summaries": [summary]}).encode(), source_compression=None
        ),
    )
    acquisition = replace(
        acquisition,
        amazon_scope="EU",
        posted_after=after,
        posted_before=before,
        marketplace_ids=(retail_id, channel_id),
        api_metadata={
            "summary_available": True,
            "coverage_marketplaces": [asdict(m) for m in markets],
        },
        documents=(replace(acquisition.documents[0], request_parameters=parameters), summary_page),
    )
    return acquisition, prepare_finances_acquisition(acquisition, storage)


class SummaryMarketplaceTests(unittest.TestCase):
    def test_combined_control_matches_without_relabeling_native_activity(self) -> None:
        for (
            retail_id,
            retail,
            channel_id,
            channel,
            retail_amount,
            channel_amount,
            total,
        ) in CHANNELS:
            with self.subTest(channel=channel):
                acquisition, prepared = candidate(
                    retail_id, channel_id, retail_amount, channel_amount, total
                )
                result = validate_finances_candidate(acquisition, prepared, [], [])
                self.assertEqual(
                    {(row.marketplace_id, row.marketplace_name) for row in result.transactions},
                    {(retail_id, retail), (channel_id, channel)},
                )
                self.assertEqual([row.marketplace_name for row in result.summaries], [retail])

    def test_omitting_non_retail_amount_does_not_pass_summary_validation(self) -> None:
        for retail_id, _, channel_id, channel, retail_amount, channel_amount, _ in CHANNELS:
            with self.subTest(channel=channel):
                acquisition, prepared = candidate(
                    retail_id, channel_id, retail_amount, channel_amount, retail_amount
                )
                with self.assertRaisesRegex(ValueError, "complete proposed transaction state"):
                    validate_finances_candidate(acquisition, prepared, [], [])

    def test_covered_empty_channels_need_the_retail_control_but_not_a_separate_channel_control(
        self,
    ) -> None:
        for retail_id, _, channel_id, channel, _, _, _ in CHANNELS:
            with self.subTest(channel=channel):
                acquisition, prepared = candidate(retail_id, channel_id, "0", "0", "0", empty=True)
                self.assertEqual(
                    validate_finances_candidate(acquisition, prepared, [], []).transactions, ()
                )
                with self.assertRaisesRegex(ValueError, "missing a covered marketplace"):
                    validate_finances_candidate(
                        acquisition, replace(prepared, summaries=()), [], []
                    )

    def test_grouping_does_not_merge_distinct_account_or_currency_controls(self) -> None:
        for retail_id, _, channel_id, channel, retail_amount, channel_amount, total in CHANNELS:
            acquisition, prepared = candidate(
                retail_id, channel_id, retail_amount, channel_amount, total
            )
            for change in ({"currency": "USD"}, {"account_type": "INVOICED_ORDERS"}):
                changed = tuple(
                    replace(row, **change) if row.marketplace_id == channel_id else row
                    for row in prepared.transactions
                )
                with (
                    self.subTest(channel=channel, change=change),
                    self.assertRaisesRegex(ValueError, "missing a native account/currency scope"),
                ):
                    validate_finances_candidate(
                        acquisition, replace(prepared, transactions=changed), [], []
                    )

    def test_duplicate_controls_for_a_shared_scope_are_rejected(self) -> None:
        for retail_id, _, channel_id, channel, retail_amount, channel_amount, total in CHANNELS:
            acquisition, prepared = candidate(
                retail_id, channel_id, retail_amount, channel_amount, total
            )
            extra = replace(
                prepared.summaries[0], marketplace_id=channel_id, marketplace_name=channel
            )
            with (
                self.subTest(channel=channel),
                self.assertRaisesRegex(ValueError, "repeats an account/currency scope"),
            ):
                validate_finances_candidate(
                    acquisition, replace(prepared, summaries=(*prepared.summaries, extra)), [], []
                )
