"""Source-only filter discovery preserves dataset visibility and stable text cursors."""

from typing import LiteralString, cast

import psycopg
from psycopg import sql

from services.db.supabase.tests import test_live_view_equivalence as live_fixture
from services.db.supabase.tests.rpc_support import assert_rpc_security
from services.db.supabase.tests.source_fixtures import SourceModelFixture

_DATASETS = {
    "live": ("live_company_components", ("sku", "marketplace_name", "source", "component_type")),
    "settlement": ("settlement_preprocess_entries", ("sku", "marketplace_name", "component_type")),
    "data_kiosk": ("data_kiosk_preprocess_entries", ("sku", "marketplace_name", "component_type")),
}


class DatasetFilterOptionsTests(SourceModelFixture):
    assign = live_fixture.LiveViewEquivalenceTests.assign
    financial_fixture = live_fixture.LiveViewEquivalenceTests.financial_fixture

    def options(
        self,
        user: str | None,
        dataset: str | None,
        field: str | None,
        limit: int | None = 1000,
        after: str | None = None,
    ) -> dict[str, object]:
        query = "select public.dataset_filter_options(%s::text,%s::text,%s::integer,%s::text)"
        values = (dataset, field, limit, after)
        result = (
            self.connection.execute(query, values).fetchall()
            if user is None
            else self.as_user(user, query, values)
        )
        return cast(dict[str, object], result[0][0])

    def expected(
        self,
        user: str | None,
        dataset: str,
        field: str,
        limit: int = 1000,
        after: str | None = None,
    ) -> dict[str, object]:
        relation, _ = _DATASETS[dataset]
        visibility = (
            "(source <> 'DATA_KIOSK' or source_amount <> 0)"
            if dataset == "live"
            else "amount <> 0"
            if dataset == "data_kiosk"
            else "true"
        )
        query = sql.SQL(
            'select distinct {field}::text collate "C" as value from public.{relation} '
            "where {field} is not null and ({visibility}) "
            'and (%s::text is null or {field}::text collate "C" > %s::text collate "C") '
            "order by value"
        ).format(
            field=sql.Identifier(field),
            relation=sql.Identifier(relation),
            visibility=sql.SQL(cast(LiteralString, visibility)),
        )
        result = (
            self.connection.execute(query, (after, after)).fetchall()
            if user is None
            else self.as_user(
                user, cast(LiteralString, query.as_string(self.connection)), (after, after)
            )
        )
        values = [cast(str, row[0]) for row in result]
        return {
            "values": values[:limit],
            "next_cursor": values[limit - 1] if len(values) > limit else None,
        }

    def assert_matches_view(
        self,
        user: str | None,
        dataset: str,
        field: str,
        limit: int = 1000,
        after: str | None = None,
    ) -> dict[str, object]:
        result = self.options(user, dataset, field, limit, after)
        self.assertEqual(result, self.expected(user, dataset, field, limit, after))
        self.assertEqual(set(result), {"values", "next_cursor"})
        self.assertTrue(
            all(isinstance(value, str) for value in cast(list[object], result["values"]))
        )
        return result

    def test_all_datasets_fields_and_roles_match_existing_visibility(self) -> None:
        first, second = self.financial_fixture()
        users = (None, self.operator(), self.member(first), self.member(second), self.auth_user())
        for user in users:
            for dataset, (_, fields) in _DATASETS.items():
                for field in fields:
                    with self.subTest(user=user, dataset=dataset, field=field):
                        self.assert_matches_view(user, dataset, field)
                        self.assert_matches_view(user, dataset, field, limit=1)

    def test_zero_kiosk_rows_and_null_values_are_excluded(self) -> None:
        company, _ = self.owner()
        self.assign("ZERO", company)
        self.kiosk(
            1,
            [
                self.component("0", sku="ZERO"),
                self.component("3"),
                self.component("1", category="SELBOX") | {"sku": None},
            ],
        )
        for user in (self.operator(), self.member(company)):
            for dataset in ("live", "data_kiosk"):
                result = self.assert_matches_view(user, dataset, "sku")
                self.assertEqual(result["values"], ["SKU"])

    def test_current_versions_and_reassigned_ownership_update_live_options(self) -> None:
        first, sku = self.owner()
        second, _ = self.owner("OTHER")
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, version = self.settlement(
            [self.transaction("1") | {"component_type": "OLD"}], acquisition_id=acquisition
        )
        _, kiosk = self.kiosk(1, [self.component("2") | {"component_type": "OLD_KIOSK"}])
        users = (None, self.operator(), self.member(first), self.member(second), self.auth_user())
        self.settlement(
            [self.transaction("3") | {"component_type": "NEW"}],
            acquisition_id=acquisition,
            expected=version,
        )
        self.kiosk(2, [], expected=kiosk)
        terms = self.assign("SKU", second, rate="7", expected=terms)
        for user in users:
            for dataset in ("live", "settlement", "data_kiosk"):
                self.assert_matches_view(user, dataset, "component_type")
        self.assertEqual(self.options(users[1], "live", "component_type")["values"], ["NEW"])
        self.assign("SKU", None, expected=terms)
        for user in users:
            self.assert_matches_view(user, "live", "sku")

    def test_more_than_one_thousand_options_use_unique_unicode_keyset_pages(self) -> None:
        company, _ = self.owner()
        types = [f"TYPE-{number:04}" for number in range(1000)] + ["A", "a", "Ä", "ä", "가", "😀"]
        self.settlement(
            [
                self.transaction("1", i + 3) | {"component_type": kind}
                for i, kind in enumerate(types)
            ]
        )
        member = self.member(company)
        first = self.assert_matches_view(member, "live", "component_type")
        self.assertEqual(len(cast(list[object], first["values"])), 1000)
        self.assertIsInstance(first["next_cursor"], str)
        second = self.assert_matches_view(
            member, "live", "component_type", after=cast(str, first["next_cursor"])
        )
        self.assertIsNone(second["next_cursor"])
        all_values = cast(list[str], first["values"]) + cast(list[str], second["values"])
        self.assertEqual(all_values, sorted(types, key=lambda value: value.encode()))
        self.assertEqual(len(all_values), len(set(all_values)))
        self.assert_matches_view(member, "live", "component_type", after="Ä", limit=2)
        self.assert_matches_view(member, "live", "component_type", after="😀")
        self.assert_matches_view(member, "live", "component_type", after="TYPE-9999")

    def test_invalid_dataset_field_limit_and_cursor_are_rejected(self) -> None:
        user = self.operator()
        for dataset, field in (
            (None, "sku"),
            ("live", None),
            ("unknown", "sku"),
            ("settlement", "source"),
            ("payouts", "sku"),
            ("live", "fee_rate_percent"),
            ("live", "sku); select 1 --"),
        ):
            with self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.options(user, dataset, field)
        for limit in (None, 0, -1, 1001):
            with self.assertRaises(psycopg.errors.InvalidParameterValue):
                self.options(user, "live", "sku", limit=limit)
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.options(user, "live", "sku", after="")
        self.assertEqual(
            self.options(user, "live", "sku", after="'); select 1; --"),
            {"values": [], "next_cursor": None},
        )

    def test_security_invoker_grants_and_anonymous_denial(self) -> None:
        assert_rpc_security(self, "public.dataset_filter_options(text,text,integer,text)")
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.dataset_filter_options('live','sku')")
