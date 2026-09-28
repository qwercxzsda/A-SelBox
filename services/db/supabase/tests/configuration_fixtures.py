"""Current SKU configuration API helpers and immutable-state regression snapshots."""

import json
from typing import Literal, TypedDict, cast

import psycopg

from psycopg.types.json import Jsonb

from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.local_database import require_row


class ConfigurationPeriod(TypedDict):
    marketplace_name: str
    valid_from: str
    valid_to: str | None
    fee_rate_percent: str


class RequiredFeeRange(TypedDict):
    marketplace_name: str
    valid_from: str
    valid_to: str


class ConfigurationIssue(TypedDict):
    sku: str
    kind: Literal["missing_company", "missing_fee"]
    marketplace_name: str | None
    valid_from: str | None
    valid_to: str | None


class ConfigurationItem(TypedDict):
    sku: str
    sku_id: str | None
    company_id: str | None
    terms_version_id: str | None
    periods: list[ConfigurationPeriod]
    requirements: list[RequiredFeeRange]
    issues: list[ConfigurationIssue]


class PublishedSku(TypedDict):
    sku: str
    terms_version_id: str


class ConfigurationPublication(TypedDict):
    published: list[PublishedSku]
    changed_count: int


class ConfigurationFixture(FinancialFixture):
    def configuration(self, user: str) -> list[ConfigurationItem]:
        result = self.as_user(user, "select public.sku_configuration()")[0][0]
        self.assertIsInstance(result, dict)
        envelope = cast(dict[str, object], result)
        self.assertEqual(set(envelope), {"items"})
        self.assertIsInstance(envelope["items"], list)
        return cast(list[ConfigurationItem], envelope["items"])

    def save(
        self, user: str, changes: object, reason: str = "Complete configuration regression"
    ) -> ConfigurationPublication:
        return cast(
            ConfigurationPublication,
            self.as_user(
                user,
                "select public.publish_sku_configuration(%s::jsonb,%s)",
                (Jsonb(changes), reason),
            )[0][0],
        )

    def assert_invalid(
        self, user: str, changes: object, reason: str = "Invalid configuration regression"
    ) -> None:
        self._assert_rejected(user, changes, "Invalid SKU configuration", reason)

    def assert_incomplete(self, user: str, changes: object) -> list[ConfigurationIssue]:
        error = self._assert_rejected(
            user, changes, "SKU configuration is incomplete", "Global completeness regression"
        )
        detail = json.loads(error.diag.message_detail or "{}")
        self.assertEqual(set(detail), {"issues"})
        self.assertTrue(detail["issues"])
        return cast(list[ConfigurationIssue], detail["issues"])

    def _assert_rejected(
        self, user: str, changes: object, message: str, reason: str
    ) -> psycopg.errors.CheckViolation:
        before = self.configuration_state()
        with self.assertRaises(psycopg.errors.CheckViolation) as error:
            self.save(user, changes, reason)
        self.assertEqual(error.exception.diag.message_primary, message)
        self.assertEqual(self.configuration_state(), before)
        return error.exception

    def change(self, sku: str, company: str | None, periods: object = None) -> dict[str, object]:
        selected = self.connection.execute(
            "select current_terms_version_id::text from public.skus where sku=%s", (sku,)
        ).fetchone()
        return {
            "sku": sku,
            "company_id": company,
            "expected_current_version_id": None if selected is None else selected[0],
            "periods": [] if periods is None else periods,
        }

    @staticmethod
    def period(
        rate: str = "5",
        *,
        marketplace: str = "Amazon.com",
        start: str = "2026-01-01",
        end: str | None = None,
    ) -> dict[str, object]:
        return {
            "marketplace_name": marketplace,
            "valid_from": start,
            "valid_to": end,
            "fee_rate_percent": rate,
        }

    def configuration_state(self) -> object:
        return require_row(
            self.connection.execute(
                "select jsonb_build_object("
                "'skus',(select jsonb_agg(to_jsonb(s) order by s.id) from public.skus s),"
                "'terms',(select jsonb_agg(to_jsonb(v) order by v.id) "
                "from public.sku_terms_versions v),"
                "'periods',(select jsonb_agg(to_jsonb(p) order by p.id) "
                "from public.sku_fee_periods p),"
                "'revisions',(select jsonb_agg(to_jsonb(r) order by r.source,r.scope_company_id) "
                "from private.workspace_revision_tokens r))"
            ).fetchone()
        )[0]
