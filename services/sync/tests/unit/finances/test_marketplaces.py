"""Coverage comes from real seller participation, including known financial channels."""

import unittest

from services.sync.src.amazon.finances.marketplaces import financial_marketplace_ids
from services.sync.src.amazon.marketplaces import get_credential_scope
from services.sync.src.finances.marketplaces import coverage_marketplaces


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
