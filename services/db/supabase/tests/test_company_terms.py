"""Complete company terms, explicit-version calculations, and current-only access."""

from decimal import Decimal
from typing import LiteralString

import psycopg

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class CompanyTermsTests(SourceModelFixture):
    def publish_terms(
        self,
        identity: str,
        company: str | None,
        periods: list[dict[str, object]],
        *,
        expected: str | None = None,
    ) -> str:
        row = self.connection.execute(
            "select seller_namespace,sku,current_terms_version_id "
            "from public.seller_skus where id=%s",
            (identity,),
        ).fetchone()
        if row is None:
            raise AssertionError("Expected a registered identity.")
        return self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "seller_sku_id": new_id(),
                "seller_namespace": row[0],
                "sku": row[1],
                "company_id": company,
                "expected_current_version_id": expected or str(row[2]),
                "change_reason": "Complete replacement",
                "periods": periods,
            },
        )

    @staticmethod
    def period(marketplace: str = "Amazon.com", rate: str = "5") -> dict[str, object]:
        return {
            "id": new_id(),
            "marketplace_name": marketplace,
            "valid_from": "2026-01-01",
            "valid_to": None,
            "fee_rate_percent": rate,
        }

    def test_whole_sku_replacement_and_explicit_version_resolution(self) -> None:
        company, identity = self.owner()
        original = self.publish_terms(
            identity, company, [self.period(), self.period("Amazon.ca", "6")]
        )
        _, settlement_version = self.settlement([self.transaction("100")])
        second_company, _ = self.owner("OTHER")
        revised = self.publish_terms(identity, second_company, [self.period(rate="7")])
        self.assertEqual(
            self.connection.execute(
                "select company_id::text,terms_version_id::text,company_amount "
                "from public.live_company_components"
            ).fetchall(),
            [(second_company, revised, Decimal(93))],
        )
        self.assertEqual(
            self.connection.execute(
                "select company_id::text,terms_version_id::text,fee_amount,company_amount "
                "from private.resolve_company_components(%s::uuid[],'{}',%s::uuid[])",
                ([settlement_version], [original]),
            ).fetchall(),
            [(company, original, Decimal(-5), Decimal(95))],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.current_sku_fee_periods "
                "where seller_sku_id=%s and marketplace_name='Amazon.ca'",
                (identity,),
            ).fetchone(),
            (0,),
        )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "select * from private.resolve_company_components(%s::uuid[],'{}',%s::uuid[])",
                ([settlement_version], [original, revised]),
            )
        self.connection.execute("set constraints all immediate")

    def test_history_and_unassigned_configuration_are_hidden_from_company_users(self) -> None:
        company, identity = self.owner()
        user = self.member(company)
        original = self.publish_terms(identity, company, [self.period()])
        self.settlement([self.transaction("100")])
        revised = self.publish_terms(identity, company, [self.period(rate="7")])
        self.assertEqual(
            self.as_user(user, "select id::text from public.sku_terms_versions"), [(revised,)]
        )
        self.assertEqual(
            self.as_user(user, "select terms_version_id::text from public.sku_fee_periods"),
            [(revised,)],
        )
        self.assertNotEqual(original, revised)
        self.assertEqual(
            self.as_user(user, "select company_amount from public.live_company_components"),
            [(Decimal(93),)],
        )
        unassigned = self.publish_terms(identity, None, [self.period(rate="9")])
        self.assertEqual(self.as_user(user, "select id from public.seller_skus"), [])
        self.assertEqual(self.as_user(user, "select id from public.sku_terms_versions"), [])
        self.assertEqual(self.as_user(user, "select id from private.settlement_transactions"), [])
        self.assertEqual(
            self.connection.execute(
                "select terms_version_id::text,resolution_status,fee_amount,company_amount "
                "from public.live_company_components"
            ).fetchall(),
            [(unassigned, "MISSING_OWNERSHIP", None, None)],
        )
        self.connection.execute("set constraints all immediate")

    def test_resolver_retains_both_explicit_source_versions_after_reprocessing(self) -> None:
        company, identity = self.owner()
        terms = self.publish_terms(identity, company, [self.period()])
        acquisition = self.acquisition()
        _, settlement_version = self.settlement(
            [self.transaction("100")], acquisition_id=acquisition
        )
        _, day_version = self.kiosk(1, [self.component("-10")])
        self.settlement(
            [self.transaction("200")], acquisition_id=acquisition, expected=settlement_version
        )
        self.kiosk(2, [self.component("-20")], expected=day_version)
        self.assertEqual(
            self.connection.execute(
                "select sum(company_amount) from public.live_company_components where authoritative"
            ).fetchone(),
            (Decimal(170),),
        )
        self.assertEqual(
            self.connection.execute(
                "select sum(company_amount) from private.resolve_company_components("
                "%s::uuid[],%s::uuid[],%s::uuid[]) where authoritative",
                ([settlement_version], [day_version], [terms]),
            ).fetchone(),
            (Decimal(85),),
        )
        self.connection.execute("set constraints all immediate")

    def test_transfer_changes_source_access_and_account_revocation_is_immediate(self) -> None:
        first_company, identity = self.owner()
        old_user = self.member(first_company)
        second_company, _ = self.owner("OTHER")
        new_user = self.member(second_company)
        self.settlement([self.transaction("100")])
        self.publish_terms(identity, second_company, [self.period()])
        self.assertEqual(
            self.as_user(old_user, "select id from private.settlement_transactions"), []
        )
        self.assertEqual(
            self.as_user(new_user, "select company_amount from public.live_company_components"),
            [(Decimal(95),)],
        )
        self.connection.execute("delete from public.app_accounts where user_id=%s", (new_user,))
        self.assertEqual(self.as_user(new_user, "select * from public.live_company_components"), [])
        self.connection.execute("set constraints all immediate")

    def test_partial_summary_preserves_null_sums_and_exact_missing_fee_details(self) -> None:
        _, identity = self.owner()
        settlement, _ = self.settlement([self.transaction("0.123456789012345678901")])
        progress = self.connection.execute(
            "select * from private.company_financial_progress("
            "%s,'2026-06-15','2026-06-15','v0',%s::uuid[],'{}')",
            (self.seller, [settlement]),
        ).fetchone()
        if progress is None:
            raise AssertionError("Expected partial summary.")
        self.assertEqual(progress[2:6], (Decimal("0.123456789012345678901"), None, None, 1))
        self.assertIsInstance(progress[6], list)
        self.assertEqual(progress[6][0]["fee_base"], "0.123456789012345678901")
        self.assertEqual(progress[6][0]["seller_sku_id"], identity)
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.totals([settlement])
        self.connection.execute("set constraints all immediate")

    def test_publication_rejects_stale_incomplete_and_ambiguous_payloads(self) -> None:
        company, identity = self.owner()
        first = self.publish_terms(identity, company, [self.period()])
        self.publish_terms(identity, company, [])
        with self.assertRaises(psycopg.errors.SerializationFailure), self.connection.transaction():
            self.publish_terms(identity, company, [], expected=first)
        for periods in ([self.period(), self.period()], [self.period(rate="5.0000000")]):
            with self.assertRaises(psycopg.Error), self.connection.transaction():
                self.publish_terms(identity, company, periods)
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.call("publish_sku_terms", {"periods": []})
        pending = new_id()
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "insert into public.sku_terms_versions"
                "(id,seller_sku_id,company_id,version_number,fee_period_count,change_reason) "
                "values (%s,%s,%s,99,1,'Incomplete')",
                (pending, identity, company),
            )
            self.connection.execute(
                "update public.seller_skus set current_terms_version_id=%s where id=%s",
                (pending, identity),
            )
        self.connection.execute("set constraints all immediate")

    def test_registered_identities_and_published_evidence_cannot_be_erased(self) -> None:
        company, identity = self.owner()
        version = self.publish_terms(identity, company, [self.period()])
        statements: list[tuple[LiteralString, tuple[str, ...]]] = [
            (
                "update public.seller_skus set current_terms_version_id=null where id=%s",
                (identity,),
            ),
            ("delete from public.seller_skus where id=%s", (identity,)),
            ("delete from public.sku_terms_versions where id=%s", (version,)),
            ("truncate public.sku_fee_periods cascade", ()),
            (
                "update public.sku_fee_periods set fee_rate_percent=7 where terms_version_id=%s",
                (version,),
            ),
        ]
        for statement, arguments in statements:
            with (
                self.subTest(statement=statement),
                self.assertRaises(psycopg.errors.CheckViolation),
                self.connection.transaction(),
            ):
                self.connection.execute(statement, arguments)
        self.connection.execute("set constraints all immediate")

    def test_new_identity_requires_selection_and_rejects_another_skus_terms(self) -> None:
        _, identity = self.owner()
        _, other = self.owner("OTHER")
        selected = self.connection.execute(
            "select current_terms_version_id from public.seller_skus where id=%s", (other,)
        ).fetchone()
        if selected is None:
            raise AssertionError("Expected selected terms.")
        with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.connection.transaction():
            self.connection.execute(
                "update public.seller_skus set current_terms_version_id=%s where id=%s",
                (selected[0], identity),
            )
        with self.assertRaises(psycopg.errors.CheckViolation), self.connection.transaction():
            self.connection.execute(
                "insert into public.seller_skus(seller_namespace,sku) values (%s,'NO-TERMS')",
                (self.seller,),
            )
            self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all immediate")
