"""Coverage comes from real seller participation, including known financial channels."""

import unittest
from datetime import UTC, date, datetime

from services.sync.src.amazon.finances.marketplaces import financial_marketplace_ids
from services.sync.src.amazon.marketplace_names import (
    marketplace_name_from_id,
    validate_marketplace_name,
)
from services.sync.src.amazon.marketplaces import get_credential_scope
from services.sync.src.finances.marketplaces import coverage_marketplaces
from services.sync.src.finances.query_windows import transaction_query_parameters


def participation(identifier: str, active: bool = True) -> dict[str, object]:
    return {"marketplace": {"id": identifier}, "participation": {"isParticipating": active}}


class MarketplaceTests(unittest.TestCase):
    def test_non_amazon_us_is_never_inferred_from_retail_participation(self) -> None:
        scope = get_credential_scope("NA")
        ids = financial_marketplace_ids([participation("ATVPDKIKX0DER")], scope)
        self.assertEqual(ids, ("ATVPDKIKX0DER",))
        self.assertEqual(len(coverage_marketplaces("NA", ids)), 1)

    def test_known_non_amazon_us_is_distinct_and_unknown_channels_do_not_invent_coverage(
        self,
    ) -> None:
        ids = financial_marketplace_ids(
            [
                participation("ATVPDKIKX0DER"),
                participation("A2ZV50J4W1RKNI"),
                participation("UNKNOWNFINANCIALCHANNEL"),
                participation("A2EUQ1WTGCTBG2", False),
            ],
            get_credential_scope("NA"),
        )
        markets = coverage_marketplaces("NA", ids)
        self.assertEqual({m.marketplace_name for m in markets}, {"Amazon.com", "Non-Amazon US"})
        self.assertEqual({m.time_zone for m in markets}, {"America/Los_Angeles"})

    def test_conflicting_participation_does_not_choose_an_arbitrary_roster(self) -> None:
        with self.assertRaisesRegex(ValueError, "conflicting"):
            financial_marketplace_ids(
                [participation("ATVPDKIKX0DER"), participation("ATVPDKIKX0DER", False)],
                get_credential_scope("NA"),
            )

    def test_foreign_credential_scope_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            coverage_marketplaces("JAPAN", ("ATVPDKIKX0DER",))

    def test_non_amazon_de_requires_its_own_active_participation(self) -> None:
        scope = get_credential_scope("EU")
        retail = participation("A1PA6795UKMFR9")
        for payload in ([retail], [retail, participation("A38D8NSA03LJTC", False)]):
            with self.subTest(payload=payload):
                self.assertEqual(financial_marketplace_ids(payload, scope), ("A1PA6795UKMFR9",))
        ids = financial_marketplace_ids(
            [retail, participation("A38D8NSA03LJTC"), participation("UNKNOWNFINANCIALCHANNEL")],
            scope,
        )
        markets = coverage_marketplaces("EU", ids)
        self.assertEqual(
            {(m.marketplace_id, m.marketplace_name, m.time_zone) for m in markets},
            {
                ("A1PA6795UKMFR9", "Amazon.de", "Europe/Berlin"),
                ("A38D8NSA03LJTC", "Non-Amazon DE", "Europe/Berlin"),
            },
        )
        self.assertEqual(validate_marketplace_name("Non-Amazon DE"), "Non-Amazon DE")
        with self.assertRaisesRegex(ValueError, "Unsupported Amazon marketplace ID"):
            marketplace_name_from_id("A38D8NSA03LJTC")

    def test_non_amazon_de_is_eu_only_and_conflicting_participation_fails(self) -> None:
        for scope_name in ("NA", "JAPAN", "SINGAPORE", "AUSTRALIA"):
            with self.subTest(scope=scope_name):
                self.assertEqual(
                    financial_marketplace_ids(
                        [participation("A38D8NSA03LJTC")], get_credential_scope(scope_name)
                    ),
                    (),
                )
                with self.assertRaisesRegex(ValueError, "outside the credential scope"):
                    coverage_marketplaces(scope_name, ("A38D8NSA03LJTC",))
        with self.assertRaisesRegex(ValueError, "conflicting"):
            financial_marketplace_ids(
                [participation("A38D8NSA03LJTC"), participation("A38D8NSA03LJTC", False)],
                get_credential_scope("EU"),
            )

    def test_non_amazon_de_uses_the_complete_25_hour_berlin_fallback_day(self) -> None:
        params = transaction_query_parameters(
            coverage_marketplaces("EU", ("A38D8NSA03LJTC",)),
            date(2026, 10, 25),
            date(2026, 10, 25),
            observed_at=datetime(2026, 10, 27, tzinfo=UTC),
        )
        self.assertEqual(
            params,
            {
                "postedAfter": "2026-10-24T22:00:00+00:00",
                "postedBefore": "2026-10-25T23:00:00+00:00",
            },
        )

    def test_non_amazon_it_requires_active_eu_participation_and_retains_rome_days(self) -> None:
        scope = get_credential_scope("EU")
        retail = participation("APJ6JRA9NG5V4")
        channel = participation("A62U237T8HV6N")
        for payload in ([retail], [retail, participation("A62U237T8HV6N", False)]):
            self.assertEqual(financial_marketplace_ids(payload, scope), ("APJ6JRA9NG5V4",))
        ids = financial_marketplace_ids([retail, channel], scope)
        self.assertEqual(
            {
                (m.marketplace_id, m.marketplace_name, m.time_zone)
                for m in coverage_marketplaces("EU", ids)
            },
            {
                ("APJ6JRA9NG5V4", "Amazon.it", "Europe/Rome"),
                ("A62U237T8HV6N", "Non-Amazon IT", "Europe/Rome"),
            },
        )
        self.assertEqual(validate_marketplace_name("Non-Amazon IT"), "Non-Amazon IT")
        with self.assertRaisesRegex(ValueError, "Unsupported Amazon marketplace ID"):
            marketplace_name_from_id("A62U237T8HV6N")
        for other in ("NA", "JAPAN", "SINGAPORE", "AUSTRALIA"):
            self.assertEqual(financial_marketplace_ids([channel], get_credential_scope(other)), ())
            with self.assertRaisesRegex(ValueError, "outside the credential scope"):
                coverage_marketplaces(other, ("A62U237T8HV6N",))
        self.assertEqual(
            transaction_query_parameters(
                coverage_marketplaces("EU", ("A62U237T8HV6N",)),
                date(2026, 10, 25),
                date(2026, 10, 25),
                observed_at=datetime(2026, 10, 27, tzinfo=UTC),
            ),
            {
                "postedAfter": "2026-10-24T22:00:00+00:00",
                "postedBefore": "2026-10-25T23:00:00+00:00",
            },
        )
