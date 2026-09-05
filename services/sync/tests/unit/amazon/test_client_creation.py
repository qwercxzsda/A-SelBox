"""Tests for explicitly credentialed Amazon client creation."""

import os
import unittest
from typing import cast
from unittest.mock import patch

from sp_api.api import DataKiosk, Reports, Sellers
from sp_api.base import Marketplaces

from ....src.amazon import client as amazon_client
from ....src.amazon.client import (
    create_data_kiosk_client,
    create_explicit_sp_api_client,
    create_reports_client,
)
from ....src.amazon.credentials import (
    AmazonLwaCredentials,
    load_lwa_credentials,
    missing_environment_names,
)
from ....src.amazon.marketplaces import (
    CREDENTIAL_SCOPES,
    AmazonCredentialScope,
    get_credential_scope,
    get_marketplace_timezone,
    validate_marketplace_scope_pair,
)
from ....src.amazon.scopes import validate_amazon_scope
from ....src.amazon.transport import AmazonTransportRoutingError

TEST_REFRESH_CREDENTIAL: str = "test-refresh-token"
TEST_LWA_APP_ID: str = "test-app-id"
TEST_LWA_CREDENTIAL: str = "test-client-secret"


def _credentials() -> AmazonLwaCredentials:
    return AmazonLwaCredentials(
        TEST_LWA_APP_ID,
        TEST_LWA_CREDENTIAL,
        TEST_REFRESH_CREDENTIAL,
    )


class TestAmazonClientCreation(unittest.TestCase):
    def test_creates_client_with_explicit_credentials(self) -> None:
        """Pass secrets explicitly to the selected marketplace transport."""
        with patch.object(amazon_client, "DataKiosk") as data_kiosk_class:
            client = create_data_kiosk_client(Marketplaces.US, _credentials())

        self.assertIs(client, data_kiosk_class.return_value)
        data_kiosk_class.assert_called_once_with(
            marketplace=Marketplaces.US,
            refresh_token=TEST_REFRESH_CREDENTIAL,
            credentials={
                "lwa_app_id": TEST_LWA_APP_ID,
                "lwa_client_secret": TEST_LWA_CREDENTIAL,
            },
        )

    def test_credentials_repr_does_not_expose_secrets(self) -> None:
        credentials = _credentials()
        self.assertEqual(
            credentials.as_sdk_credentials(),
            {
                "lwa_app_id": TEST_LWA_APP_ID,
                "lwa_client_secret": TEST_LWA_CREDENTIAL,
            },
        )
        self.assertNotIn(TEST_REFRESH_CREDENTIAL, repr(credentials))
        self.assertNotIn(TEST_LWA_CREDENTIAL, repr(credentials))

    def test_reports_client_uses_explicit_credentials(self) -> None:
        with patch.object(amazon_client, "Reports") as reports_class:
            client = create_reports_client("NA", _credentials())

        self.assertIs(client, reports_class.return_value)
        reports_class.assert_called_once()
        self.assertEqual(reports_class.call_args.kwargs["refresh_token"], TEST_REFRESH_CREDENTIAL)
        self.assertEqual(
            reports_class.call_args.kwargs["marketplace"].marketplace_id,
            "ATVPDKIKX0DER",
        )


class TestExplicitClientRouting(unittest.TestCase):
    def test_all_api_clients_use_every_sdk_marketplace_endpoint_and_region(self) -> None:
        """Exercise every installed country/transport combination without network calls."""
        credentials = _credentials()
        with patch.dict(os.environ, {}, clear=True):
            for marketplace in Marketplaces:
                for client_class in (DataKiosk, Sellers, Reports):
                    with self.subTest(
                        marketplace=marketplace.name,
                        client=client_class.__name__,
                    ):
                        client = create_explicit_sp_api_client(
                            client_class,
                            marketplace,
                            credentials,
                        )
                        try:
                            self.assertEqual(client.endpoint, marketplace.endpoint)
                            self.assertEqual(client.region, marketplace.region)
                            self.assertEqual(
                                client.marketplace_id,
                                marketplace.marketplace_id,
                            )
                        finally:
                            client.close()

    def test_conflicting_sdk_default_marketplace_fails_before_construction(self) -> None:
        with (
            patch.dict(
                os.environ,
                {"SP_API_DEFAULT_MARKETPLACE": "DE"},
                clear=False,
            ),
            patch.object(amazon_client, "Reports") as reports_class,
            self.assertRaises(AmazonTransportRoutingError),
        ):
            create_reports_client("NA", _credentials())

        reports_class.assert_not_called()

    def test_same_transport_different_country_override_also_fails(self) -> None:
        """Do not let a regional match hide an overridden request marketplace ID."""
        with (
            patch.dict(
                os.environ,
                {"SP_API_DEFAULT_MARKETPLACE": "CA"},
                clear=False,
            ),
            patch.object(amazon_client, "Reports") as reports_class,
            self.assertRaises(AmazonTransportRoutingError),
        ):
            create_reports_client("NA", _credentials())

        reports_class.assert_not_called()

    def test_invalid_sdk_default_marketplace_fails_before_construction(self) -> None:
        with (
            patch.dict(
                os.environ,
                {"SP_API_DEFAULT_MARKETPLACE": "UNKNOWN"},
                clear=False,
            ),
            patch.object(amazon_client, "Reports") as reports_class,
            self.assertRaisesRegex(AmazonTransportRoutingError, "invalid"),
        ):
            create_reports_client("NA", _credentials())

        reports_class.assert_not_called()

    def test_matching_sdk_default_marketplace_is_safe(self) -> None:
        with (
            patch.dict(
                os.environ,
                {"SP_API_DEFAULT_MARKETPLACE": "US"},
                clear=False,
            ),
            patch.object(amazon_client, "Reports") as reports_class,
        ):
            create_reports_client("NA", _credentials())

        reports_class.assert_called_once()


class TestCredentialScopeRegistry(unittest.TestCase):
    def test_named_far_east_scopes_route_to_their_exact_marketplaces(self) -> None:
        expected_marketplaces = {
            "JAPAN": "A1VC38T7YXB528",
            "SINGAPORE": "A19VAU5U5O7RUS",
            "AUSTRALIA": "A39IBJ37TRP1C6",
        }

        for scope_name, marketplace_id in expected_marketplaces.items():
            with self.subTest(scope=scope_name):
                scope = get_credential_scope(validate_amazon_scope(scope_name))
                self.assertEqual(scope.marketplace_ids, (marketplace_id,))
                self.assertEqual(scope.client_marketplace.marketplace_id, marketplace_id)

    def test_rejects_unknown_scope(self) -> None:
        with self.assertRaises(ValueError):
            validate_amazon_scope("UNKNOWN")

        with self.assertRaises(ValueError):
            create_reports_client("UNKNOWN", _credentials())

    def test_every_configured_marketplace_has_one_valid_persistence_scope(self) -> None:
        """Exercise every exact country/scope pair owned by the registry."""
        for scope_name, scope in CREDENTIAL_SCOPES.items():
            for marketplace_id in scope.marketplace_ids:
                with self.subTest(scope=scope_name, marketplace=marketplace_id):
                    validate_marketplace_scope_pair(scope_name, marketplace_id)

    def test_rejects_every_cross_scope_pair_without_reflecting_values(self) -> None:
        """Shared transport never widens JP, SG, or AU credential provenance."""
        for scope_name in CREDENTIAL_SCOPES:
            for foreign_scope_name, foreign_scope in CREDENTIAL_SCOPES.items():
                if foreign_scope_name == scope_name:
                    continue
                for marketplace_id in foreign_scope.marketplace_ids:
                    with (
                        self.subTest(scope=scope_name, marketplace=marketplace_id),
                        self.assertRaises(ValueError) as raised,
                    ):
                        validate_marketplace_scope_pair(scope_name, marketplace_id)

                    error_text = str(raised.exception)
                    self.assertNotIn(scope_name, error_text)
                    self.assertNotIn(marketplace_id, error_text)

    def test_rejects_unknown_pair_without_reflecting_values(self) -> None:
        private_scope = "PRIVATE_SCOPE_VALUE"
        private_marketplace = "PRIVATE_MARKETPLACE_VALUE"

        for amazon_scope, marketplace_id in (
            (private_scope, CREDENTIAL_SCOPES["NA"].marketplace_ids[0]),
            ("NA", private_marketplace),
        ):
            with (
                self.subTest(scope=amazon_scope, marketplace=marketplace_id),
                self.assertRaises(ValueError) as raised,
            ):
                validate_marketplace_scope_pair(amazon_scope, marketplace_id)

            error_text = str(raised.exception)
            self.assertNotIn(amazon_scope, error_text)
            self.assertNotIn(marketplace_id, error_text)

    def test_registry_owns_transport_probe_and_environment_routing(self) -> None:
        """Keep every Amazon caller on one exact scope definition."""
        eu_scope = CREDENTIAL_SCOPES["EU"]

        self.assertIs(eu_scope.client_marketplace, Marketplaces.DE)
        self.assertEqual(eu_scope.refresh_token_environment, "REFRESH_TOKEN_EU")
        self.assertIn(Marketplaces.GB.marketplace_id, eu_scope.marketplace_ids)

    def test_registry_matches_the_three_installed_sdk_transports(self) -> None:
        expected_transport = {
            "NA": ("https://sellingpartnerapi-na.amazon.com", "us-east-1"),
            "EU": ("https://sellingpartnerapi-eu.amazon.com", "eu-west-1"),
            "JAPAN": ("https://sellingpartnerapi-fe.amazon.com", "us-west-2"),
            "SINGAPORE": ("https://sellingpartnerapi-fe.amazon.com", "us-west-2"),
            "AUSTRALIA": ("https://sellingpartnerapi-fe.amazon.com", "us-west-2"),
        }

        for scope_name, scope in CREDENTIAL_SCOPES.items():
            with self.subTest(scope=scope_name):
                self.assertEqual(
                    (scope.client_marketplace.endpoint, scope.client_marketplace.region),
                    expected_transport[scope_name],
                )

    def test_registry_owns_every_installed_sdk_marketplace_exactly_once(self) -> None:
        """Catch an SDK country addition or an accidental cross-scope duplicate."""
        configured_marketplaces = tuple(
            marketplace
            for scope in CREDENTIAL_SCOPES.values()
            for marketplace in scope.marketplace_candidates
        )

        self.assertEqual(len(configured_marketplaces), len(set(configured_marketplaces)))
        self.assertEqual(set(configured_marketplaces), set(Marketplaces))
        self.assertEqual(
            {
                scope.name: tuple(marketplace.name for marketplace in scope.marketplace_candidates)
                for scope in CREDENTIAL_SCOPES.values()
            },
            {
                "NA": ("US", "CA", "MX", "BR"),
                "EU": (
                    "AE",
                    "BE",
                    "DE",
                    "EG",
                    "ES",
                    "FR",
                    "GB",
                    "IE",
                    "IN",
                    "IT",
                    "NL",
                    "PL",
                    "SA",
                    "SE",
                    "TR",
                    "ZA",
                ),
                "JAPAN": ("JP",),
                "SINGAPORE": ("SG",),
                "AUSTRALIA": ("AU",),
            },
        )

    def test_scope_model_rejects_cross_transport_candidates(self) -> None:
        with self.assertRaisesRegex(ValueError, "share one HTTP transport"):
            AmazonCredentialScope(
                "BROKEN",
                Marketplaces.US,
                (Marketplaces.US, Marketplaces.DE),
            )

    def test_registry_has_correct_named_time_zone_for_every_sdk_marketplace(self) -> None:
        expected_time_zones = {
            "AE": "Asia/Dubai",
            "BE": "Europe/Brussels",
            "DE": "Europe/Berlin",
            "PL": "Europe/Warsaw",
            "EG": "Africa/Cairo",
            "ES": "Europe/Madrid",
            "FR": "Europe/Paris",
            "GB": "Europe/London",
            "IN": "Asia/Kolkata",
            "IT": "Europe/Rome",
            "IE": "Europe/Dublin",
            "NL": "Europe/Amsterdam",
            "SA": "Asia/Riyadh",
            "SE": "Europe/Stockholm",
            "TR": "Europe/Istanbul",
            "ZA": "Africa/Johannesburg",
            "AU": "Australia/Sydney",
            "JP": "Asia/Tokyo",
            "SG": "Asia/Singapore",
            "US": "America/Los_Angeles",
            "BR": "America/Sao_Paulo",
            "CA": "America/Vancouver",
            "MX": "America/Mexico_City",
        }

        self.assertEqual(
            set(expected_time_zones), {marketplace.name for marketplace in Marketplaces}
        )
        for marketplace in Marketplaces:
            with self.subTest(marketplace=marketplace.name):
                self.assertEqual(
                    get_marketplace_timezone(cast(str, marketplace.marketplace_id)).key,
                    expected_time_zones[marketplace.name],
                )


class TestCredentialLoading(unittest.TestCase):
    def test_missing_and_whitespace_environment_values_fail_with_names_only(self) -> None:
        environment = {
            "LWA_APP_ID": " ",
            "LWA_CLIENT_SECRET": TEST_LWA_CREDENTIAL,
            "REFRESH_TOKEN_NA": "",
        }
        with patch.dict(os.environ, environment, clear=True):
            self.assertEqual(
                missing_environment_names("REFRESH_TOKEN_NA"),
                ("LWA_APP_ID", "REFRESH_TOKEN_NA"),
            )
            with self.assertRaises(RuntimeError) as raised:
                load_lwa_credentials("REFRESH_TOKEN_NA")

        error_message = str(raised.exception)
        self.assertIn("LWA_APP_ID", error_message)
        self.assertIn("REFRESH_TOKEN_NA", error_message)
        self.assertNotIn(TEST_LWA_CREDENTIAL, error_message)


if __name__ == "__main__":
    unittest.main()
