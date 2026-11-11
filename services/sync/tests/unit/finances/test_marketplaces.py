"""Coverage comes from actual participation in distinct native financial channels."""

import unittest
from datetime import UTC, date, datetime

from services.sync.src.amazon.finances.marketplaces import financial_marketplace_ids
from services.sync.src.amazon.marketplace_names import (
    marketplace_name_from_id,
    validate_marketplace_name,
)
from services.sync.src.amazon.marketplaces import get_credential_scope
from services.sync.src.finances.marketplaces import coverage_marketplaces
from services.sync.src.finances.query_windows import reconciliation_interval

# Independent expected identities: do not derive these from the registry under test.
CHANNELS = (
    ("NA", "ATVPDKIKX0DER", "Amazon.com", "A2ZV50J4W1RKNI", "Non-Amazon US", "America/Los_Angeles"),
    ("EU", "A1PA6795UKMFR9", "Amazon.de", "A38D8NSA03LJTC", "Non-Amazon DE", "Europe/Berlin"),
    ("EU", "APJ6JRA9NG5V4", "Amazon.it", "A62U237T8HV6N", "Non-Amazon IT", "Europe/Rome"),
)
SCOPES = ("NA", "EU", "JAPAN", "SINGAPORE", "AUSTRALIA")


def participation(identifier: str, active: bool = True) -> dict[str, object]:
    return {"marketplace": {"id": identifier}, "participation": {"isParticipating": active}}


class MarketplaceTests(unittest.TestCase):
    def test_native_channels_require_their_own_active_participation(self) -> None:
        for scope_name, retail_id, _, channel_id, channel_name, _ in CHANNELS:
            scope = get_credential_scope(scope_name)
            retail = participation(retail_id)
            for payload in ([retail], [retail, participation(channel_id, False)]):
                with self.subTest(channel=channel_name, payload=payload):
                    ids = financial_marketplace_ids(payload, scope)
                    self.assertEqual(ids, (retail_id,))
                    self.assertEqual(len(coverage_marketplaces(scope_name, ids)), 1)

    def test_known_channels_remain_distinct_without_inventing_other_coverage(self) -> None:
        for scope_name, retail_id, retail_name, channel_id, channel_name, zone in CHANNELS:
            with self.subTest(channel=channel_name):
                inactive_id = "A2EUQ1WTGCTBG2" if scope_name == "NA" else "A13V1IB3VIYZZH"
                ids = financial_marketplace_ids(
                    [
                        participation(retail_id),
                        participation(channel_id),
                        participation("UNKNOWNFINANCIALCHANNEL"),
                        participation(inactive_id, False),
                    ],
                    get_credential_scope(scope_name),
                )
                self.assertEqual(ids, tuple(sorted((retail_id, channel_id))))
                self.assertEqual(
                    {
                        (m.marketplace_id, m.marketplace_name, m.time_zone)
                        for m in coverage_marketplaces(scope_name, ids)
                    },
                    {(retail_id, retail_name, zone), (channel_id, channel_name, zone)},
                )
                self.assertEqual(validate_marketplace_name(channel_name), channel_name)
                with self.assertRaisesRegex(ValueError, "Unsupported Amazon marketplace ID"):
                    marketplace_name_from_id(channel_id)

    def test_conflicting_participation_does_not_choose_an_arbitrary_roster(self) -> None:
        for scope_name, identifier in [("NA", "ATVPDKIKX0DER")] + [
            (scope, channel_id) for scope, _, _, channel_id, _, _ in CHANNELS
        ]:
            with (
                self.subTest(identifier=identifier),
                self.assertRaisesRegex(ValueError, "conflicting"),
            ):
                financial_marketplace_ids(
                    [participation(identifier), participation(identifier, False)],
                    get_credential_scope(scope_name),
                )

    def test_native_channels_cannot_cross_credential_scopes(self) -> None:
        for native_scope, _, _, channel_id, channel_name, _ in CHANNELS:
            for scope_name in SCOPES:
                if scope_name == native_scope:
                    continue
                with self.subTest(channel=channel_name, scope=scope_name):
                    self.assertEqual(
                        financial_marketplace_ids(
                            [participation(channel_id)],
                            get_credential_scope(scope_name),
                        ),
                        (),
                    )
                    with self.assertRaisesRegex(ValueError, "outside the credential scope"):
                        coverage_marketplaces(scope_name, (channel_id,))

    def test_foreign_retail_credential_scope_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            coverage_marketplaces("JAPAN", ("ATVPDKIKX0DER",))

    def test_european_channels_use_the_complete_25_hour_fallback_day(self) -> None:
        for scope_name, _, _, channel_id, channel_name, _ in CHANNELS:
            if scope_name != "EU":
                continue
            with self.subTest(channel=channel_name):
                self.assertEqual(
                    reconciliation_interval(
                        coverage_marketplaces(scope_name, (channel_id,)),
                        datetime(2026, 10, 24, 22, tzinfo=UTC),
                        datetime(2026, 10, 25, 23, tzinfo=UTC),
                        observed_at=datetime(2026, 10, 27, tzinfo=UTC),
                    ),
                    (date(2026, 10, 25), date(2026, 10, 25)),
                )
