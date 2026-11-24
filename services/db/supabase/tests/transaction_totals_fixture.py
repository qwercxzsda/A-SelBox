"""Row-level oracle and RPC helpers for transaction totals and trends."""

from typing import LiteralString, cast

from psycopg import sql

from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.search_fixtures import LIVE_SEARCH_FIELDS, append_search_selections

TRANSACTION_TOTALS_PARAMETER_TYPES = {
    "p_date_from": "date",
    "p_date_to": "date",
    "p_company_ids": "uuid[]",
    "p_skus": "text[]",
    "p_marketplaces": "text[]",
    "p_currency": "text",
    "p_group_by_type": "boolean",
    "p_sources": "text[]",
    "p_types": "text[]",
    "p_fee_applicable": "boolean",
    **dict.fromkeys(LIVE_SEARCH_FIELDS, "text[]"),
    "p_granularity": "text",
}
_NUMERIC_FIELDS = (
    "reported_amount",
    "service_fee",
    "company_amount",
    "row_count",
    "known_company_count",
)
_ROW_FIELDS = ("marketplace_name", "currency", "component_type", "period_start", *_NUMERIC_FIELDS)


class TransactionTotalsFixture(FinancialFixture):
    def read_totals(self, user: str | None, **options: object) -> dict[str, object]:
        options = {"p_date_from": "2026-01-01", **options}
        arguments = sql.SQL(", ").join(
            sql.SQL("{} => %s::{}").format(
                sql.Identifier(name),
                sql.SQL(cast(LiteralString, TRANSACTION_TOTALS_PARAMETER_TYPES[name])),
            )
            for name in options
        )
        query = sql.SQL("select public.transaction_totals({})").format(arguments)
        result = (
            self.connection.execute(query, tuple(options.values())).fetchall()
            if user is None
            else self.as_user(
                user, cast(LiteralString, query.as_string(self.connection)), tuple(options.values())
            )
        )
        return cast(dict[str, object], result[0][0])

    def expected(self, user: str | None, **options: object) -> dict[str, object]:
        options = {"p_date_from": "2026-01-01", **options}
        predicates: list[sql.Composable] = [sql.SQL("true")]
        parameters: list[object] = []
        for name, column, comparison, type_name in (
            ("p_date_from", "utc_date", ">=", "date"),
            ("p_date_to", "utc_date", "<=", "date"),
            ("p_currency", "currency", "=", "text"),
        ):
            if options.get(name) is not None:
                predicates.append(
                    sql.SQL("{} {} %s::{}").format(
                        sql.Identifier(column),
                        sql.SQL(cast(LiteralString, comparison)),
                        sql.SQL(cast(LiteralString, type_name)),
                    )
                )
                parameters.append(options[name])
        for name, column, type_name in (
            ("p_company_ids", "company_id", "uuid[]"),
            ("p_skus", "sku", "text[]"),
            ("p_marketplaces", "marketplace_name", "text[]"),
            ("p_sources", "source", "text[]"),
            ("p_types", "component_type", "text[]"),
        ):
            if options.get(name):
                predicates.append(
                    sql.SQL("{} = any(%s::{})").format(
                        sql.Identifier(column), sql.SQL(cast(LiteralString, type_name))
                    )
                )
                parameters.append(options[name])
        if options.get("p_skus"):
            predicates.append(sql.SQL("outcome <> 'SELBOX'"))
        if options.get("p_fee_applicable") is not None:
            predicates.append(sql.SQL("(fee_base is not null) = %s::boolean"))
            parameters.append(options["p_fee_applicable"])
        append_search_selections(predicates, parameters, LIVE_SEARCH_FIELDS, options)
        query = sql.SQL("""
            with source_rows as (
                select c.*, (activity_at at time zone 'UTC')::date as utc_date
                from public.live_company_components c
            ), totals as (select
                case when %s::boolean then marketplace_name end as marketplace_name,
                currency,
                case when %s::boolean then component_type end as component_type,
                date_trunc(%s::text, utc_date::timestamp)::date::text as period_start,
                sum(source_amount)::text as reported_amount,
                sum(fee_amount)::text as service_fee,
                sum(company_amount)::text as company_amount,
                count(*)::text as row_count,
                count(company_amount)::text as known_company_count
            from source_rows where {predicates}
            group by 1,2,3,4) select * from totals
            order by marketplace_name collate "C" nulls first,
                currency collate "C", period_start nulls first,
                component_type collate "C" nulls first
        """).format(predicates=sql.SQL(" and ").join(predicates))
        granularity = options.get("p_granularity")
        parameters[:0] = [
            not options.get("p_group_by_type", False) or granularity is not None,
            options.get("p_group_by_type", False) or granularity is not None,
            granularity,
        ]
        result = (
            self.connection.execute(query, parameters).fetchall()
            if user is None
            else self.as_user(
                user, cast(LiteralString, query.as_string(self.connection)), parameters
            )
        )
        rows = [dict(zip(_ROW_FIELDS, row, strict=True)) for row in result]
        return {"rows": rows, "group_count": str(len(rows))}

    def assert_matches_view(self, user: str | None, **options: object) -> dict[str, object]:
        actual = self.read_totals(user, **options)
        self.assertEqual(actual, self.expected(user, **options))
        self.assertEqual(set(actual), {"rows", "group_count"})
        for row in cast(list[dict[str, object]], actual["rows"]):
            self.assertEqual(set(row), set(_ROW_FIELDS))
            for key in _NUMERIC_FIELDS:
                self.assertTrue(row[key] is None or isinstance(row[key], str))
            self.assertIsNotNone(row["row_count"])
            self.assertIsNotNone(row["known_company_count"])
        return actual
