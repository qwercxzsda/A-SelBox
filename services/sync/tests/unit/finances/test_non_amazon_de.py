"""Native German financial activity retains its channel, exact money and local day."""

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


def german_transaction(identifier: str, posted: str, marketplace_id: str) -> dict[str, object]:
    row = native_transaction(identifier, amount="1.234567891", posted=posted, status="RELEASED")
    # Native fixture monetary nodes share this currency object, as they share one currency.
    cast(dict[str, object], row["totalAmount"])["currencyCode"] = "EUR"
    cast(dict[str, object], row["sellingPartnerMetadata"])["marketplaceId"] = marketplace_id
    return row


def october_capture(
    storage: MemoryArchiveStorage,
    rows: list[dict[str, object]],
    marketplace_ids: tuple[str, ...] = ("A1PA6795UKMFR9", "A38D8NSA03LJTC"),
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


class NonAmazonGermanyTests(unittest.TestCase):
    def test_replay_keeps_distinct_native_identity_and_both_dst_fold_hours(self) -> None:
        storage = MemoryArchiveStorage()
        rows = [
            german_transaction(identifier, posted, "A38D8NSA03LJTC")
            for identifier, posted in (
                ("before", "2026-10-24T21:59:59Z"),
                ("start", "2026-10-24T22:00:00Z"),
                ("fold-first", "2026-10-25T00:30:00Z"),
                ("fold-second", "2026-10-25T01:30:00Z"),
                ("last", "2026-10-25T22:59:59Z"),
                ("after", "2026-10-25T23:00:00Z"),
            )
        ]
        rows.append(german_transaction("retail", "2026-10-25T12:00:00Z", "A1PA6795UKMFR9"))
        prepared = prepare_finances_acquisition(october_capture(storage, rows), storage)
        days = {day.marketplace_name: day for day in prepared.days}
        self.assertEqual(set(days), {"Amazon.de", "Non-Amazon DE"})
        native = days["Non-Amazon DE"]
        self.assertEqual(
            (native.marketplace_id, native.activity_date), ("A38D8NSA03LJTC", date(2026, 10, 25))
        )
        self.assertCountEqual(
            [transaction.native_transaction_id for transaction in native.transactions],
            ["start", "fold-first", "fold-second", "last"],
        )
        self.assertEqual(
            sum((transaction.total_amount for transaction in native.transactions), ZERO),
            Numeric("4.938271564"),
        )
        self.assertTrue(all(transaction.currency == "EUR" for transaction in native.transactions))
        self.assertTrue(
            all(
                component.currency == "EUR"
                for transaction in native.transactions
                for component in transaction.components
            )
        )
        self.assertEqual(days["Amazon.de"].marketplace_id, "A1PA6795UKMFR9")
        self.assertEqual(
            [transaction.native_transaction_id for transaction in days["Amazon.de"].transactions],
            ["retail"],
        )
        self.assertEqual(prepared.summaries, ())

    def test_known_channel_still_requires_declared_archive_coverage(self) -> None:
        storage = MemoryArchiveStorage()
        row = german_transaction("native", "2026-10-25T12:00:00Z", "A38D8NSA03LJTC")
        acquisition = october_capture(storage, [row], ("A1PA6795UKMFR9",))
        with self.assertRaisesRegex(ValueError, "outside declared coverage"):
            prepare_finances_acquisition(acquisition, storage)

    def test_native_channel_cannot_be_relabelled_or_given_the_us_timezone(self) -> None:
        storage = MemoryArchiveStorage()
        acquisition = october_capture(storage, [], ("A38D8NSA03LJTC",))
        for invalid in (
            {"marketplace_name": "Amazon.de", "time_zone": "Europe/Berlin"},
            {"marketplace_name": "Non-Amazon DE", "time_zone": "America/Los_Angeles"},
        ):
            with self.subTest(invalid=invalid):
                malformed = replace(
                    acquisition,
                    api_metadata={
                        "summary_available": False,
                        "coverage_marketplaces": [{"marketplace_id": "A38D8NSA03LJTC", **invalid}],
                    },
                )
                with self.assertRaisesRegex(ValueError, "canonical marketplace registry"):
                    prepare_finances_acquisition(malformed, storage)
