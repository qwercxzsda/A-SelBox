"""Configuration transport validation and access guards reject partial or invalid writes."""

from typing import LiteralString

import psycopg
from psycopg.types.json import Jsonb

from services.db.supabase.tests.configuration_fixtures import ConfigurationFixture


class SkuConfigurationValidationTests(ConfigurationFixture):
    def test_only_operator_can_publish_and_anonymous_configuration_access_is_denied(self) -> None:
        company, _ = self.owner()
        changes = [self.change(" API SKU ", company)]
        for user in (self.member(company), self.auth_user(), ""):
            with self.subTest(user=user), self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.save(user, changes)
        statements: tuple[tuple[LiteralString, tuple[object, ...]], ...] = (
            ("select public.publish_sku_configuration(%s::jsonb,%s)", (Jsonb(changes), "Denied")),
            ("select public.sku_configuration()", ()),
        )
        for query, arguments in statements:
            with (
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute("set local role anon")
                self.connection.execute(query, arguments)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.skus where sku=' API SKU '"
            ).fetchone(),
            (0,),
        )

    def test_invalid_payloads_rates_ranges_and_overlaps_leave_no_partial_versions(self) -> None:
        company, _ = self.owner("A")
        operator = self.operator()
        change = self.change("A", company, [self.period()])
        self.connection.commit()
        before = self.configuration_state()
        invalid: list[object] = [
            [],
            None,
            {},
            [None],
            [{}],
            [change, change],
            [change | {"sku": "  "}],
            [change | {"seller_namespace": "must-not-be-an-identity"}],
            [change | {"sku_id": "caller-cannot-provide-generated-id"}],
            [change | {"company_id": "bad-id"}],
            [change | {"expected_current_version_id": "bad-id"}],
            [change | {"periods": None}],
            [change | {"periods": [None]}],
        ]
        invalid.extend(
            [change | {"periods": [self.period(rate)]}]
            for rate in (
                "-1",
                "100.000001",
                "NaN",
                "Infinity",
                "5.0000000",
                "",
            )
        )
        invalid.extend(
            [change | {"periods": [self.period() | fields]}]
            for fields in (
                {"valid_from": None},
                {"valid_from": "2026-02-30"},
                {"valid_from": "2026-6-1"},
                {"valid_from": "infinity"},
                {"valid_to": "2026-01-01"},
                {"valid_to": "2025-12-31"},
                {"marketplace_name": "unknown"},
                {"fee_rate_percent": None},
                {"fee_rate_percent": 5},
                {"fee_rate_percent": True},
                {"id": "caller-cannot-provide-generated-period-id"},
            )
        )
        invalid.append([change | {"periods": [self.period(), self.period("7")]}])
        for payload in invalid:
            with self.subTest(payload=payload):
                self.assert_invalid(operator, payload)
        self.assert_invalid(operator, [change], reason="")
        self.assertEqual(self.configuration_state(), before)
