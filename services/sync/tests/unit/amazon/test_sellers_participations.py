"""Tests for scoped Sellers API marketplace-participation discovery."""

import unittest
from typing import cast
from unittest.mock import patch

from sp_api.base import ApiResponse, Marketplaces

from ....src.amazon import sellers_participations
from ....src.amazon.credentials import AmazonLwaCredentials
from ....src.amazon.marketplaces import CREDENTIAL_SCOPES, get_credential_scope
from ....src.amazon.sellers_participations import (
    MarketplaceParticipation,
    SellersParticipationResponseError,
    fetch_marketplace_participations,
)

TEST_REFRESH_TOKEN = "private-refresh-token"  # noqa: S105
TEST_LWA_APP_ID = "private-app-id"
TEST_LWA_CLIENT_SECRET = "private-client-secret"  # noqa: S105
US_MARKETPLACE_ID = cast(str, Marketplaces.US.marketplace_id)
CA_MARKETPLACE_ID = cast(str, Marketplaces.CA.marketplace_id)
JP_MARKETPLACE_ID = cast(str, Marketplaces.JP.marketplace_id)
SG_MARKETPLACE_ID = cast(str, Marketplaces.SG.marketplace_id)
COUNTRY_CODE_BY_MARKETPLACE_ID = {
    cast(str, marketplace.marketplace_id): marketplace.name for marketplace in Marketplaces
}


class FakeSellersClient:
    def __init__(
        self,
        payload: object,
        *,
        request_error: Exception | None = None,
        close_error: Exception | None = None,
    ) -> None:
        """Configure a response and optional request or cleanup failures."""
        self.payload = payload
        self.request_error = request_error
        self.close_error = close_error
        self.request_count = 0
        self.closed = False

    def get_marketplace_participation(self) -> ApiResponse:
        """Return the configured payload or request failure."""
        self.request_count += 1
        if self.request_error is not None:
            raise self.request_error
        return ApiResponse(payload=self.payload)

    def close(self) -> None:
        """Record cleanup and optionally fail."""
        self.closed = True
        if self.close_error is not None:
            raise self.close_error


def _credentials(
    *,
    refresh_token: str = TEST_REFRESH_TOKEN,
    lwa_app_id: str = TEST_LWA_APP_ID,
    lwa_client_secret: str = TEST_LWA_CLIENT_SECRET,
) -> AmazonLwaCredentials:
    return AmazonLwaCredentials(
        lwa_app_id=lwa_app_id,
        lwa_client_secret=lwa_client_secret,
        refresh_token=refresh_token,
    )


def _entry(
    marketplace_id: str,
    *,
    name: str,
    participating: object,
    domain_name: str = "www.example.invalid",
    country_code: str | None = None,
) -> dict[str, object]:
    marketplace: dict[str, object] = {
        "id": marketplace_id,
        "name": name,
        "countryCode": country_code or COUNTRY_CODE_BY_MARKETPLACE_ID.get(marketplace_id, "US"),
        "defaultCurrencyCode": "USD",
        "defaultLanguageCode": "en_US",
        "domainName": domain_name,
    }
    return {
        "marketplace": marketplace,
        "participation": {
            "isParticipating": participating,
            "hasSuspendedListings": False,
        },
        "storeName": "Private store",
    }


class TestFetchMarketplaceParticipations(unittest.TestCase):
    def test_intersects_every_regional_response_with_each_named_scope(self) -> None:
        """Keep NA/EU broad while isolating each credential-specific FE country."""
        for scope in CREDENTIAL_SCOPES.values():
            regional_marketplace_ids = tuple(
                cast(str, marketplace.marketplace_id)
                for marketplace in Marketplaces
                if marketplace.endpoint == scope.client_marketplace.endpoint
                and marketplace.region == scope.client_marketplace.region
            )
            client = FakeSellersClient(
                [
                    _entry(
                        marketplace_id,
                        name=f"Marketplace {index}",
                        participating=True,
                    )
                    for index, marketplace_id in enumerate(
                        reversed(regional_marketplace_ids),
                        start=1,
                    )
                ]
            )

            with (
                self.subTest(scope=scope.name),
                patch.object(sellers_participations, "Sellers", return_value=client),
            ):
                result = fetch_marketplace_participations(scope, _credentials())

            self.assertEqual(
                tuple(participation.marketplace_id for participation in result),
                scope.marketplace_ids,
            )
            self.assertTrue(client.closed)

    def test_uses_explicit_credentials_and_returns_only_active_scope_metadata(self) -> None:
        """Use the scope transport while filtering API rows to the exact scope."""
        scope = get_credential_scope("JAPAN")
        client = FakeSellersClient(
            [
                _entry(
                    JP_MARKETPLACE_ID,
                    name="Amazon.co.jp",
                    participating=True,
                    domain_name="www.amazon.co.jp",
                ),
                _entry(
                    SG_MARKETPLACE_ID,
                    name="Amazon.sg",
                    participating=True,
                ),
                _entry(
                    JP_MARKETPLACE_ID + "-inactive",
                    name="Inactive",
                    participating=False,
                ),
            ]
        )

        with patch.object(sellers_participations, "Sellers", return_value=client) as sellers:
            result = fetch_marketplace_participations(scope, _credentials())

        self.assertEqual(
            result,
            (
                MarketplaceParticipation(
                    marketplace_id=JP_MARKETPLACE_ID,
                    name="Amazon.co.jp",
                    domain_name="www.amazon.co.jp",
                ),
            ),
        )
        sellers.assert_called_once_with(
            marketplace=Marketplaces.JP,
            refresh_token=TEST_REFRESH_TOKEN,
            credentials={
                "lwa_app_id": TEST_LWA_APP_ID,
                "lwa_client_secret": TEST_LWA_CLIENT_SECRET,
            },
        )
        self.assertEqual(client.request_count, 1)
        self.assertTrue(client.closed)

    def test_preserves_trimmed_international_marketplace_metadata(self) -> None:
        client = FakeSellersClient(
            [
                _entry(
                    JP_MARKETPLACE_ID,
                    name="  Amazon 日本  ",
                    participating=True,
                    domain_name="  www.amazon.co.jp  ",
                )
            ]
        )

        with patch.object(sellers_participations, "Sellers", return_value=client):
            result = fetch_marketplace_participations(
                get_credential_scope("JAPAN"),
                _credentials(),
            )

        self.assertEqual(result[0].name, "Amazon 日本")
        self.assertEqual(result[0].domain_name, "www.amazon.co.jp")

    def test_omits_inactive_entries(self) -> None:
        """Return only explicitly participating marketplaces in the configured scope."""
        client = FakeSellersClient(
            [
                _entry(
                    US_MARKETPLACE_ID,
                    name="Amazon.com",
                    participating=True,
                ),
                _entry(
                    CA_MARKETPLACE_ID,
                    name="Amazon.ca",
                    participating=False,
                ),
            ]
        )

        with patch.object(sellers_participations, "Sellers", return_value=client):
            result = fetch_marketplace_participations(
                get_credential_scope("NA"),
                _credentials(),
            )

        self.assertEqual(
            tuple(value.marketplace_id for value in result),
            (US_MARKETPLACE_ID,),
        )

    def test_rejects_active_marketplace_missing_from_installed_registry(self) -> None:
        """Fail closed when Amazon adds an active country before the SDK registry."""
        private_unknown_id = "AUNKNOWNCOUNTRY1"
        client = FakeSellersClient(
            [
                _entry(US_MARKETPLACE_ID, name="Amazon.com", participating=True),
                _entry(
                    private_unknown_id,
                    name="New country",
                    country_code="ZZ",
                    participating=True,
                ),
            ]
        )

        with (
            patch.object(sellers_participations, "Sellers", return_value=client),
            self.assertRaisesRegex(
                SellersParticipationResponseError,
                "without an active canonical store",
            ) as raised,
        ):
            fetch_marketplace_participations(get_credential_scope("NA"), _credentials())

        self.assertNotIn(private_unknown_id, str(raised.exception))
        self.assertTrue(client.closed)

    def test_ignores_alternate_active_identity_for_an_active_canonical_country(self) -> None:
        """Real Sellers responses can include noncanonical IDs for the same country."""
        client = FakeSellersClient(
            [
                _entry(US_MARKETPLACE_ID, name="Amazon.com", participating=True),
                _entry(
                    "AALTERNATEUSID",
                    name="Alternate US identity",
                    country_code="US",
                    participating=True,
                ),
            ]
        )

        with patch.object(sellers_participations, "Sellers", return_value=client):
            result = fetch_marketplace_participations(
                get_credential_scope("NA"),
                _credentials(),
            )

        self.assertEqual(tuple(item.marketplace_id for item in result), (US_MARKETPLACE_ID,))

    def test_rejects_canonical_marketplace_with_conflicting_country_code(self) -> None:
        client = FakeSellersClient(
            [
                _entry(
                    US_MARKETPLACE_ID,
                    name="Amazon.com",
                    country_code="CA",
                    participating=True,
                )
            ]
        )

        with (
            patch.object(sellers_participations, "Sellers", return_value=client),
            self.assertRaisesRegex(
                SellersParticipationResponseError,
                "unexpected country code",
            ),
        ):
            fetch_marketplace_participations(get_credential_scope("NA"), _credentials())

    def test_ignores_known_active_marketplace_from_another_transport(self) -> None:
        """Real Sellers responses can include configured countries from other regions."""
        de_marketplace_id = cast(str, Marketplaces.DE.marketplace_id)
        client = FakeSellersClient(
            [
                _entry(US_MARKETPLACE_ID, name="Amazon.com", participating=True),
                _entry(de_marketplace_id, name="Amazon.de", participating=True),
            ]
        )

        with patch.object(sellers_participations, "Sellers", return_value=client):
            result = fetch_marketplace_participations(
                get_credential_scope("NA"),
                _credentials(),
            )

        self.assertEqual(
            tuple(item.marketplace_id for item in result),
            (US_MARKETPLACE_ID,),
        )

    def test_returns_participations_in_configured_candidate_order(self) -> None:
        """Keep report request chunking deterministic despite API row order."""
        client = FakeSellersClient(
            [
                _entry(CA_MARKETPLACE_ID, name="Amazon.ca", participating=True),
                _entry(US_MARKETPLACE_ID, name="Amazon.com", participating=True),
            ]
        )

        with patch.object(sellers_participations, "Sellers", return_value=client):
            result = fetch_marketplace_participations(
                get_credential_scope("NA"),
                _credentials(),
            )

        self.assertEqual(
            tuple(value.marketplace_id for value in result),
            (US_MARKETPLACE_ID, CA_MARKETPLACE_ID),
        )

    def test_deduplicates_identical_marketplace_entries(self) -> None:
        """Accept an exact repeated row without returning duplicate metadata."""
        entry = _entry(
            US_MARKETPLACE_ID,
            name="Amazon.com",
            participating=True,
            domain_name="www.amazon.com",
        )
        client = FakeSellersClient([entry, dict(entry)])

        with patch.object(sellers_participations, "Sellers", return_value=client):
            result = fetch_marketplace_participations(
                get_credential_scope("NA"),
                _credentials(),
            )

        self.assertEqual(len(result), 1)

    def test_rejects_conflicting_duplicate_marketplace_entries(self) -> None:
        """Reject disagreement in either metadata or participation for one ID."""
        base = _entry(
            US_MARKETPLACE_ID,
            name="Amazon.com",
            participating=True,
        )
        conflicts = (
            _entry(
                US_MARKETPLACE_ID,
                name="Different name",
                participating=True,
            ),
            _entry(
                US_MARKETPLACE_ID,
                name="Amazon.com",
                participating=False,
            ),
        )

        for conflict in conflicts:
            with self.subTest(conflict=conflict):
                client = FakeSellersClient([base, conflict])
                with (
                    patch.object(sellers_participations, "Sellers", return_value=client),
                    self.assertRaisesRegex(
                        SellersParticipationResponseError,
                        "conflicting duplicate",
                    ),
                ):
                    fetch_marketplace_participations(
                        get_credential_scope("NA"),
                        _credentials(),
                    )
                self.assertTrue(client.closed)

    def test_rejects_malformed_payloads_without_representing_response(self) -> None:
        """Require the documented list, nested objects, fields, and Boolean flag."""
        malformed_payloads: tuple[object, ...] = (
            {},
            {"marketplace": []},
            [None],
            [{"marketplace": {}, "participation": {"isParticipating": True}}],
            [
                {
                    "marketplace": {
                        "id": US_MARKETPLACE_ID,
                        "name": "Amazon.com",
                        "defaultCurrencyCode": "USD",
                    },
                    "participation": None,
                }
            ],
            [
                _entry(
                    US_MARKETPLACE_ID,
                    name="Amazon.com",
                    participating=1,
                )
            ],
            [
                _entry(
                    US_MARKETPLACE_ID,
                    name=" ",
                    participating=True,
                )
            ],
            [
                _entry(
                    US_MARKETPLACE_ID,
                    name="Amazon.com",
                    participating=True,
                    domain_name=" ",
                )
            ],
        )

        for payload in malformed_payloads:
            with self.subTest(payload_type=type(payload).__name__):
                client = FakeSellersClient(payload)
                with (
                    patch.object(sellers_participations, "Sellers", return_value=client),
                    self.assertRaises(SellersParticipationResponseError) as raised,
                ):
                    fetch_marketplace_participations(
                        get_credential_scope("NA"),
                        _credentials(),
                    )
                message = str(raised.exception)
                self.assertNotIn(TEST_REFRESH_TOKEN, message)
                self.assertNotIn(TEST_LWA_CLIENT_SECRET, message)
                self.assertTrue(client.closed)

    def test_suppresses_cleanup_failure_after_success(self) -> None:
        """Do not turn a successful response into a credential-adjacent cleanup error."""
        client = FakeSellersClient(
            [
                _entry(
                    US_MARKETPLACE_ID,
                    name="Amazon.com",
                    participating=False,
                )
            ],
            close_error=RuntimeError("private cleanup detail"),
        )

        with patch.object(sellers_participations, "Sellers", return_value=client):
            result = fetch_marketplace_participations(
                get_credential_scope("NA"),
                _credentials(),
            )

        self.assertEqual(result, ())
        self.assertTrue(client.closed)

    def test_preserves_request_failure_when_cleanup_also_fails(self) -> None:
        """Always close, but retain the request exception as the useful failure."""
        request_error = RuntimeError("request failed")
        client = FakeSellersClient(
            [],
            request_error=request_error,
            close_error=RuntimeError("cleanup failed"),
        )

        with (
            patch.object(sellers_participations, "Sellers", return_value=client),
            self.assertRaises(RuntimeError) as raised,
        ):
            fetch_marketplace_participations(
                get_credential_scope("NA"),
                _credentials(),
            )

        self.assertIs(raised.exception, request_error)
        self.assertTrue(client.closed)

    def test_rejects_blank_credentials_before_creating_client(self) -> None:
        """Fail at the shared credential boundary before constructing an SDK client."""
        invalid_values = (
            ("refresh_token", {"refresh_token": ""}),
            ("lwa_app_id", {"lwa_app_id": " "}),
            ("lwa_client_secret", {"lwa_client_secret": ""}),
        )

        for field_name, overrides in invalid_values:
            with (
                self.subTest(field_name=field_name),
                patch.object(sellers_participations, "Sellers") as sellers,
                self.assertRaisesRegex(ValueError, field_name),
            ):
                _credentials(**overrides)
            sellers.assert_not_called()


if __name__ == "__main__":
    unittest.main()
