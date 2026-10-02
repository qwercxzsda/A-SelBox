"""Transaction page argument, marketplace and execution-permission contracts."""

from typing import cast

import psycopg

from services.db.supabase.tests.rpc_support import assert_rpc_contract
from services.db.supabase.tests.transaction_fixtures import (
    TRANSACTION_ARRAY_FILTERS,
    TRANSACTION_PARAMETER_TYPES,
    TransactionPageFixture,
)


class TransactionPageValidationTests(TransactionPageFixture):
    def test_anonymous_callers_cannot_execute(self) -> None:
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.transaction_page()")
        assert_rpc_contract(self, "transaction_page", TRANSACTION_PARAMETER_TYPES)

    def test_text_marketplaces_preserve_rows_and_counts_for_all_roles(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user, total in (
            (self.operator(), "20"),
            (self.member(company_a), "10"),
            (self.member(company_b), "2"),
            (self.auth_user(), "0"),
        ):
            for selection in (
                None,
                [],
                ["Amazon.com"],
                ["Amazon.com", "Amazon.com"],
                ["Amazon.com", "Amazon.co.uk"],
                ["Amazon.co.uk"],
            ):
                expected_count = "0" if selection == ["Amazon.co.uk"] else total
                for include_count in (False, True):
                    with self.subTest(selection=selection, count=include_count):
                        page = self.assert_matches_view(
                            user,
                            p_marketplaces=selection,
                            p_include_count=include_count,
                            p_limit=1000,
                        )
                        self.assertEqual(len(cast(list[object], page["rows"])), int(expected_count))
                        self.assertEqual(
                            page["total_count"], expected_count if include_count else None
                        )

    def test_unknown_marketplaces_are_rejected_instead_of_ignored(self) -> None:
        company_a, company_b = self.financial_fixture()
        for user in (
            self.operator(),
            self.member(company_a),
            self.member(company_b),
            self.auth_user(),
        ):
            for selection in (
                ["Unknown marketplace"],
                ["Amazon.com", "Unknown marketplace"],
                ["amazon.com"],
                ["Amazon.com", "AMAZON.COM"],
                [" Amazon.com"],
                ["Amazon.com "],
                [""],
            ):
                with (
                    self.subTest(selection=selection),
                    self.assertRaises(psycopg.errors.InvalidParameterValue),
                ):
                    self.page(user, p_marketplaces=selection)

    def test_invalid_scalar_arguments_are_rejected(self) -> None:
        operator = self.operator()
        invalid: tuple[dict[str, object], ...] = (
            {"p_limit": None},
            {"p_limit": 0},
            {"p_limit": -1},
            {"p_limit": 1001},
            {"p_offset": None},
            {"p_offset": -1},
            {"p_offset": 9007199254740992},
            {"p_order_by": None},
            {"p_order_by": "company_amount"},
            {"p_order_by": "amount; drop table public.companies"},
            {"p_direction": None},
            {"p_direction": "sideways"},
            {"p_include_count": None},
            {"p_date_from": "2026-06-17", "p_date_to": "2026-06-16"},
            {"p_date_from": "-infinity"},
            {"p_date_to": "infinity"},
        )
        for options in invalid:
            with (
                self.subTest(options=options),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
            ):
                self.page(operator, **options)

    def test_invalid_filter_array_shapes_are_rejected(self) -> None:
        company, _ = self.owner()
        operator = self.operator()
        for name in TRANSACTION_ARRAY_FILTERS:
            value = (
                company
                if name == "p_company_ids"
                else "Amazon.com"
                if name == "p_marketplaces"
                else "SKU"
            )
            for values in ([None], [value, None], [[value]]):
                with (
                    self.subTest(name=name, values=values),
                    self.assertRaises(psycopg.errors.InvalidParameterValue),
                ):
                    self.page(operator, **{name: values})
