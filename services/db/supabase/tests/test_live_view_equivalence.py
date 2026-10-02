"""The relational live view preserves the explicit resolver's full row contract."""

from decimal import Decimal, localcontext
from typing import LiteralString, cast

from psycopg import sql

from services.db.supabase.tests.financial_fixtures import FinancialFixture
from services.db.supabase.tests.local_database import require_row

_COMPARISON: LiteralString = """
with reference as materialized (
    select * from private.resolve_company_components(
        array(select current_version_id::uuid from private.settlements
            where current_version_id is not null),
        array(select current_version_id::uuid from private.data_kiosk_days
            where current_version_id is not null),
        array(select current_terms_version_id::uuid from public.skus
            where current_terms_version_id is not null)
    )
), actual as materialized (
    select * from public.live_company_components where {predicate}
    order by activity_date desc nulls last, source, source_row_id {limit_clause}
), expected as materialized (
    select * from reference where {predicate}
    order by activity_date desc nulls last, source, source_row_id {limit_clause}
), differences as (
    (select * from actual except all select * from expected)
    union all
    (select * from expected except all select * from actual)
)
select (select count(*) from actual), (select count(*) from expected), count(*)
from differences
"""


class LiveViewEquivalenceTests(FinancialFixture):
    def assert_matches_resolver(
        self,
        user: str | None,
        expected_rows: int,
        predicate: LiteralString = "true",
        parameters: tuple[object, ...] = (),
        *,
        limit: int | None = None,
    ) -> None:
        query = sql.SQL(_COMPARISON).format(
            predicate=sql.SQL(predicate),
            limit_clause=sql.SQL("")
            if limit is None
            else sql.SQL("limit {}").format(sql.Literal(limit)),
        )
        with self.connection.transaction():
            if user is not None:
                self.connection.execute(
                    "select set_config('request.jwt.claim.sub',%s,true)", (user,)
                )
                self.connection.execute("set local role authenticated")
            result = self.connection.execute(query, parameters + parameters).fetchone()
            if user is not None:
                self.connection.execute("reset role")
        count = expected_rows if limit is None else min(limit, expected_rows)
        self.assertEqual(result, (count, count, 0))

    def test_all_fields_match_for_roles_filters_categories_and_exact_amounts(self) -> None:
        company_a, company_b = self.financial_fixture()
        member_a, member_b, operator = (
            self.member(company_a),
            self.member(company_b),
            self.operator(),
        )
        scopes: tuple[tuple[LiteralString, tuple[object, ...], tuple[int, int, int]], ...] = (
            ("true", (), (23, 12, 2)),
            ("company_id = %s::uuid", (company_a,), (12, 12, 0)),
            ("company_id = %s::uuid", (company_b,), (2, 0, 2)),
            ("activity_date = %s::date", ("2026-06-15",), (21, 10, 2)),
            ("sku = %s", ("SKU",), (12, 11, 0)),
            ("source = %s", ("DATA_KIOSK",), (10, 6, 1)),
            (
                "marketplace_name = %s and component_type = %s",
                ("Amazon.com", "FbaStorageFee"),
                (9, 5, 1),
            ),
            ("authoritative", (), (20, 10, 2)),
            (
                "activity_date = %s::date and sku = %s and authoritative",
                ("2026-06-15", "SKU"),
                (8, 7, 0),
            ),
        )
        for predicate, parameters, counts in scopes:
            for user, expected_rows in (
                (None, counts[0]),
                (operator, counts[0]),
                (member_a, counts[1]),
                (member_b, counts[2]),
            ):
                with self.subTest(role="trusted" if user is None else user, predicate=predicate):
                    self.assert_matches_resolver(user, expected_rows, predicate, parameters)
        for user, count in ((None, 23), (operator, 23), (member_a, 12), (member_b, 2)):
            with self.subTest(page_role="trusted" if user is None else user):
                self.assert_matches_resolver(user, count, limit=3)
        self.assert_matches_resolver(self.auth_user(), 0)

        exact = Decimal("100.123456789012345678901")
        with localcontext() as context:
            context.prec = 80
            expected_fee = -exact * Decimal("0.05125")
            expected_company = exact + expected_fee
        self.assertEqual(
            self.connection.execute(
                "select source_amount,fee_amount,company_amount "
                "from public.live_company_components "
                "where source='SETTLEMENT' and seller_namespace='seller-one' "
                "and sku='SKU' and source_amount > 100 and source_amount < 101"
            ).fetchone(),
            (exact, expected_fee, expected_company),
        )
        self.assertEqual(
            self.connection.execute(
                "select bool_and(sku_id is not null and terms_version_id is not null "
                "and company_id is null and fee_period_id is null and fee_rate_percent is null "
                "and resolution_status='MISSING_OWNERSHIP' and fee_amount is null "
                "and company_amount is null) from public.live_company_components "
                "where sku='UNASSIGNED'"
            ).fetchone(),
            (True,),
        )

    def test_reprocessing_and_reassignment_only_change_current_rows(self) -> None:
        company_a, sku = self.owner()
        company_b, _ = self.owner("OTHER")
        members = (self.member(company_a), self.member(company_b))
        operator = self.operator()
        terms = self.fee(sku, [("2026-01-01", None, "5")])
        acquisition = self.acquisition()
        _, old_settlement = self.settlement([self.transaction("100")], acquisition_id=acquisition)
        _, old_kiosk = self.kiosk(1, [self.component("-10")])
        _, new_settlement = self.settlement(
            [self.transaction("200")],
            acquisition_id=acquisition,
            expected=old_settlement,
        )
        _, new_kiosk = self.kiosk(2, [self.component("-20")], expected=old_kiosk)
        revised_terms = self.assign("SKU", company_b, rate="7", expected=terms)
        for user, count in ((None, 3), (operator, 3), (members[0], 0), (members[1], 2)):
            self.assert_matches_resolver(user, count)
        self.assertEqual(
            {
                str(row[0])
                for row in self.connection.execute(
                    "select source_version_id from public.live_company_components "
                    "where source<>'RECONCILIATION'"
                ).fetchall()
            },
            {new_settlement, new_kiosk},
        )
        self.assertEqual(
            self.as_user(
                members[1], "select sum(company_amount) from public.live_company_components"
            ),
            [(Decimal(166),)],
        )
        self.assertEqual(
            require_row(
                self.connection.execute(
                    "select sum(company_amount) from private.resolve_company_components("
                    "%s::uuid[],%s::uuid[],%s::uuid[])",
                    ([old_settlement], [old_kiosk], [terms]),
                ).fetchone()
            )[0],
            Decimal(85),
        )
        self.assign("SKU", None, rate="7", expected=revised_terms)
        for user, count in ((None, 3), (operator, 3), (members[0], 0), (members[1], 0)):
            self.assert_matches_resolver(user, count)
        self.connection.execute("set constraints all immediate")

    def test_date_and_sku_filters_reach_fact_scans_without_materializing_the_resolver(self) -> None:
        company, sku = self.owner()
        self.fee(sku, [("2026-01-01", None, "5")])
        self.settlement([self.transaction("100")])
        self.kiosk(1, [self.component("-10")])
        result = self.as_user(
            self.member(company),
            "explain (format json, verbose) select * from public.live_company_components "
            "where activity_date between '2026-06-15' and '2026-06-16' and sku='SKU' "
            "order by activity_date desc nulls last, source, source_row_id limit 25",
        )
        root = cast(list[dict[str, object]], result[0][0])[0]["Plan"]
        pending = [cast(dict[str, object], root)]
        nodes: list[dict[str, object]] = []
        while pending:
            node = pending.pop()
            nodes.append(node)
            pending.extend(cast(list[dict[str, object]], node.get("Plans", [])))
        self.assertFalse(
            any(
                node.get("Node Type") == "Function Scan"
                and node.get("Function Name") == "resolve_company_components"
                for node in nodes
            ),
            "The live view must allow filtering before the full-history resolver materializes rows",
        )
        for relation, date_column in (
            ("settlement_transactions", "posted_date"),
            ("data_kiosk_transactions", "activity_date"),
        ):
            with self.subTest(relation=relation):
                conditions = [
                    " ".join(
                        str(node.get(key, "")) for key in ("Filter", "Index Cond", "Recheck Cond")
                    )
                    for node in nodes
                    if node.get("Relation Name") == relation
                ]
                self.assertTrue(
                    any(
                        date_column in condition and "2026-06-15" in condition
                        for condition in conditions
                    ),
                    "The date bound must reach the source scan, regardless of the chosen scan type",
                )
