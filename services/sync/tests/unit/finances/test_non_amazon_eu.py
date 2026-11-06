"""Native European channels retain distinct identities, exact money and local days."""

import unittest
from dataclasses import asdict, replace
from datetime import UTC, date, datetime
from typing import cast

from services.sync.src.finances.acquisition_models import FinancesAcquisition
from services.sync.src.finances.marketplaces import coverage_marketplaces
from services.sync.src.finances.preprocess import prepare_finances_acquisition
from services.sync.src.finances.query_windows import transaction_query_parameters
from services.sync.src.numeric import ZERO, Numeric
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.finances import finances_acquisition, native_transaction

CHANNELS = (
    ("A1PA6795UKMFR9", "Amazon.de", "A38D8NSA03LJTC", "Non-Amazon DE", "Europe/Berlin"),
    ("APJ6JRA9NG5V4", "Amazon.it", "A62U237T8HV6N", "Non-Amazon IT", "Europe/Rome"),
)


def euro_transaction(identifier: str, posted: str, marketplace_id: str) -> dict[str, object]:
    row = native_transaction(identifier, amount="1.234567891", posted=posted, status="RELEASED")
    # Native fixture monetary nodes share this currency object, as they share one currency.
    cast(dict[str, object], row["totalAmount"])["currencyCode"] = "EUR"
    cast(dict[str, object], row["sellingPartnerMetadata"])["marketplaceId"] = marketplace_id
    return row


def october_capture(
    storage: MemoryArchiveStorage,
    rows: list[dict[str, object]],
    marketplace_ids: tuple[str, ...],
) -> FinancesAcquisition:
    acquisition = finances_acquisition(storage, rows)
    observed_at = datetime(2026, 10, 27, tzinfo=UTC)
    day = date(2026, 10, 25)
    marketplaces = coverage_marketplaces("EU", marketplace_ids)
    parameters = transaction_query_parameters(marketplaces, day, day, observed_at=observed_at)
    return replace(
        acquisition,
        amazon_scope="EU",
        capture_started_at=observed_at,
        downloaded_at=observed_at,
        query_start_date=day,
        query_end_date=day,
        marketplace_ids=marketplace_ids,
        api_metadata={
            "summary_available": False,
            "coverage_marketplaces": [asdict(marketplace) for marketplace in marketplaces],
        },
        documents=tuple(
            replace(
                page,
                request_parameters=parameters,
                requested_at=observed_at,
                received_at=observed_at,
            )
            for page in acquisition.documents
        ),
    )


class NonAmazonEuropeTests(unittest.TestCase):
    def test_replay_keeps_distinct_native_identity_and_both_dst_fold_hours(self) -> None:
        for retail_id, retail_name, channel_id, channel_name, _ in CHANNELS:
            with self.subTest(channel=channel_name):
                storage = MemoryArchiveStorage()
                rows = [
                    euro_transaction(identifier, posted, channel_id)
                    for identifier, posted in (
                        ("before", "2026-10-24T21:59:59Z"),
                        ("start", "2026-10-24T22:00:00Z"),
                        ("fold-first", "2026-10-25T00:30:00Z"),
                        ("fold-second", "2026-10-25T01:30:00Z"),
                        ("last", "2026-10-25T22:59:59Z"),
                        ("after", "2026-10-25T23:00:00Z"),
                    )
                ]
                rows.append(euro_transaction("retail", "2026-10-25T12:00:00Z", retail_id))
                prepared = prepare_finances_acquisition(
                    october_capture(storage, rows, (retail_id, channel_id)), storage
                )
                native = [
                    row for row in prepared.transactions if row.marketplace_name == channel_name
                ]
                retail = [
                    row for row in prepared.transactions if row.marketplace_name == retail_name
                ]
                self.assertTrue(
                    all(
                        row.marketplace_id == channel_id and row.posted_date == date(2026, 10, 25)
                        for row in native
                    )
                )
                self.assertCountEqual(
                    [row.native_transaction_id for row in native],
                    ["start", "fold-first", "fold-second", "last"],
                )
                self.assertEqual(
                    sum((row.total_amount for row in native), ZERO), Numeric("4.938271564")
                )
                self.assertTrue(all(row.currency == "EUR" for row in native))
                self.assertEqual([row.native_transaction_id for row in retail], ["retail"])
                self.assertTrue(all(row.marketplace_id == retail_id for row in retail))
                self.assertEqual(prepared.summaries, ())

    def test_known_channels_still_require_declared_archive_coverage(self) -> None:
        for retail_id, _, channel_id, channel_name, _ in CHANNELS:
            with self.subTest(channel=channel_name):
                storage = MemoryArchiveStorage()
                row = euro_transaction("native", "2026-10-25T12:00:00Z", channel_id)
                acquisition = october_capture(storage, [row], (retail_id,))
                with self.assertRaisesRegex(ValueError, "outside declared coverage"):
                    prepare_finances_acquisition(acquisition, storage)

    def test_native_channels_cannot_be_relabelled_or_given_the_us_timezone(self) -> None:
        for _, retail_name, channel_id, channel_name, zone in CHANNELS:
            storage = MemoryArchiveStorage()
            acquisition = october_capture(storage, [], (channel_id,))
            for invalid in (
                {"marketplace_name": retail_name, "time_zone": zone},
                {"marketplace_name": channel_name, "time_zone": "America/Los_Angeles"},
            ):
                with self.subTest(channel=channel_name, invalid=invalid):
                    malformed = replace(
                        acquisition,
                        api_metadata={
                            "summary_available": False,
                            "coverage_marketplaces": [{"marketplace_id": channel_id, **invalid}],
                        },
                    )
                    with self.assertRaisesRegex(ValueError, "canonical marketplace registry"):
                        prepare_finances_acquisition(malformed, storage)
