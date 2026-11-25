"""Regression coverage for reference attribution and immutable company payouts."""

from datetime import timedelta
from decimal import Decimal
from uuid import uuid7

import psycopg

from services.db.supabase.tests.reference_fixture import ReferenceFixture


class ReferenceOutcomeTests(ReferenceFixture):
    def test_utc_count_and_trend_keep_local_day_reference_ownership(self) -> None:
        self.assign_sku("A", self.company)
        self.reference(
            "INVENTORY_LEDGER",
            "2026-01",
            [{"month": "2026-01-01", "sku": "A", "fnsku": "X000000001", "asin": "B000000001"}],
        )
        charge = {
            "route": "FNSKU",
            "fnsku": "X000000001",
            "start": "2026-01-01",
            "end": "2026-01-01",
            "date": "2026-01-31",
        }
        self.finance(
            [
                {**charge, "instant": "2026-01-31T18:00:00Z", "amount": -9},
                {**charge, "instant": "2026-02-01T01:00:00Z", "amount": -3},
            ]
        )
        self.assertEqual(
            self.one(
                "select public.transaction_count(p_date_from=>'2026-02-01',"
                "p_date_to=>'2026-02-01',p_marketplaces=>array['Amazon.com'])"
            ),
            "1",
        )
        rows = self.connection.execute(
            "select r->>'period_start',r->>'reported_amount' from jsonb_array_elements("
            "public.transaction_totals(p_date_from=>'2026-02-01',p_date_to=>'2026-02-01',"
            "p_granularity=>'day')->'rows') r"
        ).fetchall()
        self.assertEqual(rows, [("2026-02-01", "-3")])

    def test_ledger_differences_and_duplicate_removal_rows(self) -> None:
        self.assign_sku("A", self.company)
        self.assign_sku("B", self.other)
        first = self.reference(
            "INVENTORY_LEDGER",
            "2026-01",
            [
                {"month": "2026-01-01", "sku": "A", "fnsku": "X000000001", "asin": "B000000001"},
                {"month": "2026-01-01", "sku": "B", "fnsku": "X000000002", "asin": "B000000001"},
            ],
        )
        row = {
            "currency": "USD",
            "base_amount": "3",
            "fee_amount": "3.3",
            "removal_order_id": "remove",
            "requested_at": "2026-01-01",
            "last_updated_at": "2026-01-10",
            "order_type": "Disposal",
            "order_status": "Completed",
            "disposed_quantity": "1",
            "tax_amount": "0.3",
            "fnsku": "X000000001",
            "ledger_first_month": "2026-01-01",
            "ledger_last_month": "2026-01-01",
        }
        self.reference("REMOVAL_ORDER", "remove", [row, row])
        self.finance(
            [
                {"route": "REMOVAL_ORDER", "key": "remove", "amount": "-2.2"},
                {"route": "REMOVAL_ORDER", "key": "remove", "amount": "-4.4", "date": "2026-02-15"},
                {
                    "route": "ASIN",
                    "asin": "B000000001",
                    "amount": -1,
                    "start": "2026-01-01",
                    "end": "2026-01-01",
                },
                {
                    "route": "FNSKU",
                    "fnsku": "X000000099",
                    "amount": -2,
                    "start": "2026-01-01",
                    "end": "2026-01-01",
                },
                {
                    "route": "FNSKU",
                    "fnsku": "X000000099",
                    "amount": -3,
                    "start": "2025-12-01",
                    "end": "2026-01-01",
                },
                {"route": "SHIPMENT", "amount": -4},
            ]
        )
        found = dict(
            self.connection.execute(
                "select reason,sum(base_amount+tax_amount) from private.financial_outcomes "
                "where reason is not null group by reason"
            ).fetchall()
        )
        self.assertEqual(
            found,
            {
                "SPLIT_OWNERSHIP": -1,
                "NOT_IN_LEDGER": -2,
                "LEDGER_MONTH_NOT_LOADED": -3,
                "NO_ID_ON_CHARGE": -4,
                "CHARGED_IN_ANOTHER_MONTH": 0,
                "TOTALS_DIFFER": 0,
            },
        )
        totals = dict(
            self.connection.execute("""
            select extract(month from posted_date)::int,sum(base_amount+tax_amount)
            from private.financial_outcomes group by 1""").fetchall()
        )
        self.assertEqual(totals, {1: Decimal("-12.2"), 2: Decimal("-4.4")})
        # February's charge is explained by January's anchor and warehouse rows.
        self.assertEqual(
            self.one(
                "select sum(base_amount + tax_amount) from private.indirect_financial_amounts("
                "null, null, '2026-02-01', '2026-03-01', 'Amazon.com') "
                "where reason='CHARGED_IN_ANOTHER_MONTH'"
            ),
            Decimal("-4.4"),
        )
        self.assertEqual(
            self.one("select sum(source_amount) from private.company_components"), Decimal("-6.6")
        )
        self.assertEqual(
            self.one(
                "select current_version_id from private.source_units where "
                "source='INVENTORY_LEDGER'"
            ),
            first,
        )

        late_report = self.one(
            "select report_id from private.generate_company_payout_reports(%s,'2026-02-01')",
            (self.company,),
        )
        pinned = self.connection.execute(
            "select u.source::text from private.payout_report_source_versions p "
            "join private.source_units u on u.id=p.unit_id where p.report_id=%s",
            (late_report,),
        ).fetchall()
        self.assertIn(("REMOVAL_ORDER",), pinned)
        self.assertIn(("INVENTORY_LEDGER",), pinned)
        self.assertEqual(pinned.count(("FINANCES",)), 2)

    def test_defaults_and_pinned_report(self) -> None:
        self.assign_sku("A", self.company, 10)
        self.finance(
            [
                {
                    "route": "SKU",
                    "type": "PRODUCT_SALES",
                    "order": "customer",
                    "sku": "A",
                    "fee_base": 100,
                    "amount": 100,
                },
                {"route": "CUSTOMER_ORDER", "key": "customer", "amount": -2},
                {"route": "AD_INVOICE", "key": "invoice", "amount": -5},
                {"route": "PROMOTION", "key": "promo", "amount": -1},
                {"route": "SELBOX", "amount": -3},
            ]
        )
        self.reference(
            "AD_INVOICE",
            "invoice",
            [
                {
                    "base_amount": "4",
                    "cost_amount": "4",
                    "ad_program": "SPONSORED_PRODUCTS",
                    "tax_amount": "0",
                    "line_kind": "CAMPAIGN",
                    "campaign_id": "ad",
                },
                {
                    "base_amount": "1",
                    "cost_amount": "1",
                    "tax_amount": "0",
                    "line_kind": "ACCOUNT_ADJUSTMENT",
                    "adjustment_kind": "ROUNDING",
                },
            ],
        )
        self.reference("CAMPAIGN", "ad", [{"asin": "B000000001"}])
        self.reference("PROMOTION", "promo", [{"sku": "A"}])
        self.assertEqual(self.one("select private.default_reference_assignments()"), 1)
        self.reference(
            "INVENTORY_LEDGER",
            "2026-01",
            [{"sku": "A", "asin": "B000000001", "fnsku": "X000000001", "month": "2026-01-01"}],
        )
        self.assertEqual(self.one("select private.default_reference_assignments()"), 1)
        self.assertEqual(self.one("select private.default_reference_assignments()"), 0)
        report = self.one(
            "select report_id from private.generate_company_payout_reports(%s,'2026-01-01')",
            (self.company,),
        )
        self.assertEqual(
            self.one(
                "select company_amount from public.company_payout_reports where id=%s", (report,)
            ),
            83,
        )
        self.assertEqual(
            self.one(
                "select count(*) from private.payout_report_assignment_versions where report_id=%s",
                (report,),
            ),
            3,
        )
        self.assertFalse(
            self.one(
                "select created from private.generate_company_payout_reports(%s,'2026-01-01')",
                (self.company,),
            )
        )
        self.reference("PROMOTION", "promo", [], when=self.observed_at + timedelta(days=1))
        self.assertEqual(
            self.one("select company_id from private.assignment_candidates where kind='PROMOTION'"),
            self.company,
        )
        self.assertEqual(
            self.one(
                "select sum(company_amount) from private.read_payout_report_records(%s)", (report,)
            ),
            83,
        )
        self.assertEqual(self.one("select (public.transaction_count())::int"), 6)
        self.assertEqual(
            self.one("select jsonb_array_length(public.transaction_page()->'rows')"), 6
        )
        self.assertEqual(
            self.one(
                """select (public.transaction_totals('2026-01-01','2026-01-31')->'rows'->0
                 ->>'company_amount')::numeric"""
            ),
            83,
        )

    def test_unassigned_application_account_has_no_financial_access(self) -> None:
        user_id = uuid7()
        self.connection.execute("insert into auth.users(id) values(%s)", (user_id,))
        self.connection.execute(
            "select set_config('request.jwt.claim.sub',%s,true)", (str(user_id),)
        )
        self.connection.execute("set local role authenticated")
        self.assertEqual(self.one("select count(*) from public.live_company_components"), 0)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("select * from public.financial_outcomes").fetchall()

    def test_storage_month_uses_country_rows_and_aged_snapshot_units(self) -> None:
        self.assign_sku("A", self.company)
        self.reference(
            "INVENTORY_LEDGER",
            "2026-01",
            [{"sku": "A", "asin": "B000000001", "fnsku": "X000000001", "month": "2026-01-01"}],
        )
        row = {
            "marketplace_name": "Amazon.com",
            "country_code": "US",
            "asin": "B000000001",
            "currency": "USD",
            "base_amount": "1.005",
            "fee_amount": "1.005",
            "tax_amount": "0",
            "fnsku": "X000000001",
            "ledger_first_month": "2026-01-01",
            "ledger_last_month": "2026-01-01",
        }
        storage = row | {"month_of_charge": "2026-01-01"}
        self.reference(
            "STORAGE",
            "2026-01",
            [
                storage,
                storage
                | {"marketplace_name": "Amazon.ca", "base_amount": "20", "fee_amount": "20"},
            ],
        )
        aged = row | {"snapshot_month": "2026-01-01", "snapshot_at": "2026-01-15T08:00:00Z"}
        self.reference(
            "AGED_STORAGE", "2026-01", [aged, aged | {"snapshot_at": "2026-01-15T08:01:00Z"}]
        )
        self.finance(
            [
                {"route": "STORAGE", "month": "2026-01-01", "amount": "-1.01"},
                {"route": "AGED_STORAGE", "month": "2026-01-01", "amount": "-2.01"},
            ]
        )
        self.assertEqual(
            self.one("select sum(source_amount) from private.company_components"), Decimal("-3.015")
        )
        self.assertEqual(
            self.one("select base_amount from private.financial_outcomes where reason='ROUNDING'"),
            Decimal("-0.005"),
        )

    def test_missing_rate_only_blocks_its_owner_and_members_see_their_report(self) -> None:
        self.assign_sku("A", self.company)
        self.assign_sku("B", self.other, 10)
        self.finance(
            [
                {"route": "SKU", "sku": "A", "amount": 1, "fee_base": 1},
                {"route": "SKU", "sku": "B", "amount": 10, "fee_base": 10},
                {"route": "SKU", "sku": "UNKNOWN", "amount": 30, "fee_base": 30},
            ]
        )
        self.assertEqual(
            self.one(
                "select count(*) from private.financial_outcomes where reason='NO_ASSIGNMENT'"
            ),
            1,
        )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "select * from private.generate_company_payout_reports(%s,'2026-01-01')",
                (self.company,),
            )
        report = self.one(
            "select report_id from private.generate_company_payout_reports(%s,'2026-01-01')",
            (self.other,),
        )
        user = uuid7()
        self.connection.execute("insert into auth.users(id) values(%s)", (user,))
        self.connection.execute(
            "update public.app_accounts set access_role='member',company_id=%s where user_id=%s",
            (self.other, user),
        )
        self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(user),))
        self.connection.execute("set local role authenticated")
        self.assertEqual(self.one("select count(*) from public.live_company_components"), 1)
        self.assertEqual(
            self.one(
                "select public.payout_report_totals(%s)->'rows'->0->>'company_amount'", (report,)
            ),
            "9.00",
        )
        # The company owns no campaign, promotion or shipment, so its member lists none.
        self.assertEqual(self.one("select public.reference_assignments()"), {"items": []})
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute(
                "select public.set_reference_assignment('seller','NA','CAMPAIGN','id',%s,null,"
                "'Test')",
                (self.other,),
            )

    def test_cleared_promotion_remains_unassigned_and_records_the_administrator(self) -> None:
        self.assign_sku("PARENT", self.company)
        self.reference("PROMOTION", "autumn", [{"sku": "PARENT"}])
        self.assertEqual(self.one("select private.default_reference_assignments()"), 1)
        previous = self.one("select id from private.current_reference_assignments")
        administrator = uuid7()
        self.connection.execute("insert into auth.users(id) values (%s)", (administrator,))
        self.connection.execute(
            "update public.app_accounts set access_role='administrator' where user_id=%s",
            (administrator,),
        )
        self.connection.execute(
            "select set_config('request.jwt.claim.sub',%s,true)", (str(administrator),)
        )
        self.connection.execute("set local role authenticated")
        cleared = self.one(
            "select public.set_reference_assignment(%s,'NA','PROMOTION','autumn',null,%s,%s)",
            (self.seller, previous, "Awaiting ownership review"),
        )
        self.assertEqual(
            self.connection.execute(
                "select company_id,origin,set_by,memo,version_number from "
                "public.assignment_versions "
                "where id=%s",
                (cleared,),
            ).fetchone(),
            (None, "ADMINISTRATOR", administrator, "Awaiting ownership review", 2),
        )
        with self.assertRaises(psycopg.Error) as stale, self.connection.transaction():
            self.one(
                "select public.set_reference_assignment(%s,'NA','PROMOTION','autumn',%s,%s,"
                "'Review')",
                (self.seller, self.company, previous),
            )
        self.assertEqual(stale.exception.sqlstate, "PT409")
        self.connection.execute("reset role")
        self.assertEqual(self.one("select private.default_reference_assignments()"), 0)
        self.assertEqual(
            self.one("select warning from private.assignment_candidates where native_key='autumn'"),
            "NO_ASSIGNMENT",
        )

    def test_admin_source_drilldown_retains_reference_amounts_as_printed(self) -> None:
        version = self.reference(
            "STORAGE",
            "2026-01",
            [
                {
                    "marketplace_name": "Amazon.com",
                    "country_code": "US",
                    "asin": "B000000001",
                    "fnsku": "X000000001",
                    "currency": "USD",
                    "month_of_charge": "2026-01-01",
                    "base_amount": "3.125",
                    "fee_amount": "3.125",
                    "tax_amount": "0",
                    "ledger_first_month": "2026-01-01",
                    "ledger_last_month": "2026-01-01",
                }
            ],
        )
        row_id = self.one("select id from private.storage_rows where version_id=%s", (version,))
        user = uuid7()
        self.connection.execute("insert into auth.users(id) values(%s)", (user,))
        self.connection.execute(
            "update public.app_accounts set access_role='administrator' where user_id=%s", (user,)
        )
        self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(user),))
        self.connection.execute("set local role authenticated")
        result = self.connection.execute(
            "select entry->>'base_amount',entry->>'fee_amount',entry->>'country_code' "
            "from public.financial_source_record('STORAGE',%s,%s) entry",
            (row_id, version),
        ).fetchone()
        self.assertEqual(result, ("3.125", "3.125", "US"))

    def test_release_copy_supplies_order_skus_without_counting_release_money(self) -> None:
        self.assign_sku("A", self.company)
        self.finance(
            [
                {
                    "route": "SKU",
                    "sku": "A",
                    "amount": 100,
                    "order": "customer",
                    "is_activity": False,
                },
                {"route": "CUSTOMER_ORDER", "key": "customer", "amount": -6},
            ]
        )
        self.assertEqual(
            self.connection.execute(
                "select company_id,base_amount from private.financial_outcomes"
            ).fetchall(),
            [(self.company, -6)],
        )

    def test_rounding_and_reconciliation_discrepancy_are_distinct(self) -> None:
        self.assign_sku("A", self.company)
        self.reference(
            "INVENTORY_LEDGER",
            "2026-01",
            [{"month": "2026-01-01", "sku": "A", "fnsku": "X000000001", "asin": "B000000001"}],
        )
        self.reference(
            "STORAGE",
            "2026-01",
            [
                {
                    "marketplace_name": "Amazon.com",
                    "country_code": "US",
                    "asin": "B000000001",
                    "fnsku": "X000000001",
                    "currency": "USD",
                    "month_of_charge": "2026-01-01",
                    "base_amount": "1.005",
                    "fee_amount": "1.005",
                    "tax_amount": "0",
                    "ledger_first_month": "2026-01-01",
                    "ledger_last_month": "2026-01-01",
                }
            ],
        )
        self.finance([{"route": "STORAGE", "month": "2026-01-01", "amount": "-1.20"}])
        self.assertEqual(
            dict(
                self.connection.execute(
                    "select reason,base_amount from private.financial_outcomes where reason is "
                    "not null"
                ).fetchall()
            ),
            {"ROUNDING": Decimal("-0.005"), "TOTALS_DIFFER": Decimal("-0.19")},
        )
        totals = self.connection.execute(
            "select sum(base_amount) filter (where measure='FINANCES'),"
            "sum(base_amount) filter (where measure<>'FINANCES') "
            "from private.monthly_outcomes(null,null,null)"
        ).fetchone()
        self.assertEqual(totals, (Decimal("-1.20"), Decimal("-1.20")))
