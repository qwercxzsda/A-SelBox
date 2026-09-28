"""Cheap change tokens track committed publications without exposing private rows."""

from datetime import date
from typing import cast

import psycopg

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id

_POLL = "select public.workspace_revisions(%s::text[])"
_SOURCES = ["settlement", "data_kiosk", "fees"]
_FACT_STATS = (
    "select relname,seq_scan,seq_tup_read,idx_scan,idx_tup_fetch from pg_stat_xact_user_tables "
    "where relname in ('settlement_transactions','data_kiosk_transactions') order by relname"
)


class WorkspaceRevisionTests(SourceModelFixture):
    def poll(self, user: str, sources: list[str] | None = None) -> dict[str, object]:
        rows = self.as_user(user, _POLL, (_SOURCES if sources is None else sources,))
        return cast(dict[str, object], rows[0][0])

    def revisions(self, user: str) -> dict[str, str]:
        return cast(dict[str, str], self.poll(user)["revisions"])

    def test_subset_empty_request_and_account_identity(self) -> None:
        company, _ = self.owner()
        member, operator = self.member(company), self.operator()
        self.connection.commit()
        for user, role, company_id in (
            (member, "company_member", company),
            (operator, "operator", None),
        ):
            with self.subTest(role=role):
                response = self.poll(user, ["settlement", "fees"])
                self.assertEqual(
                    response["account"],
                    {"user_id": user, "access_role": role, "company_id": company_id},
                )
                self.assertEqual(
                    set(cast(dict[str, str], response["revisions"])), {"settlement", "fees"}
                )
                self.assertEqual(self.poll(user, [])["revisions"], {})
        mature_cutoff_date = require_row(
            self.connection.execute("select private.mature_cutoff_date()").fetchone()
        )[0]
        self.assertEqual(self.revisions(member)["settlement"], f"0:{mature_cutoff_date}")
        self.assertEqual(self.revisions(member)["data_kiosk"], f"0:{mature_cutoff_date}")

    def test_mature_cutoff_date_change_invalidates_source_tokens_without_an_import(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        before = self.revisions(member)
        with self.connection.transaction(force_rollback=True):
            self.set_mature_cutoff_date(date(2000, 1, 1))
            after = self.revisions(member)
            self.assertNotEqual(before["settlement"], after["settlement"])
            self.assertNotEqual(before["data_kiosk"], after["data_kiosk"])
            self.assertEqual(before["fees"], after["fees"])

    def test_requires_current_application_access_and_never_grants_private_table_access(
        self,
    ) -> None:
        company, _ = self.owner()
        member, unaffiliated = self.member(company), self.auth_user()
        self.connection.commit()
        for user in (unaffiliated, member):
            if user == member:
                self.connection.execute(
                    "delete from public.app_accounts where user_id=%s", (member,)
                )
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.poll(user)
        with self.assertRaises(psycopg.errors.InsufficientPrivilege), self.connection.transaction():
            self.connection.execute("set local role anon")
            self.connection.execute("select public.workspace_revisions()")
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.as_user(unaffiliated, "select * from private.workspace_revision_tokens")
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.as_user(
                unaffiliated, "select private.bump_workspace_revision('fees','{}'::uuid[])"
            )

    def test_reassignment_is_visible_in_account_snapshot_without_claim_refresh(self) -> None:
        company_a, _ = self.owner()
        company_b, _ = self.owner("OTHER")
        member = self.member(company_a)
        self.connection.commit()
        first = self.poll(member)
        self.connection.execute(
            "update public.app_accounts set company_id=%s where user_id=%s", (company_b, member)
        )
        self.connection.commit()
        self.assertNotEqual(self.poll(member)["account"], first["account"])
        self.assertEqual(
            cast(dict[str, str], self.poll(member)["account"])["company_id"], company_b
        )

    def test_invalid_source_arguments_are_rejected(self) -> None:
        operator = self.operator()
        for sources in (None, ["private"], [None], ["fees"] * 4, [["fees", "settlement"]]):
            with (
                self.subTest(sources=sources),
                self.assertRaises(psycopg.errors.InvalidParameterValue),
            ):
                self.as_user(operator, _POLL, (sources,))

    def test_settlement_backdated_republication_rotates_only_source_at_commit(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        self.connection.commit()
        initial = self.revisions(member)
        acquisition = self.acquisition()
        self.connection.commit()
        self.assertEqual(self.revisions(member), initial)
        _, version = self.settlement(
            [self.transaction("5", activity_date="2026-06-01")],
            acquisition_id=acquisition,
            version="v99",
        )
        self.assertEqual(self.revisions(member), initial)
        self.connection.commit()
        first = self.revisions(member)
        self.assertNotEqual(first["settlement"], initial["settlement"])
        self.assertEqual(first["fees"], initial["fees"])
        self.settlement([], acquisition_id=acquisition, expected=version, version="v1")
        self.connection.commit()
        self.assertNotEqual(self.revisions(member)["settlement"], first["settlement"])

    def test_kiosk_history_and_empty_replacement_rotate_source_at_commit(
        self,
    ) -> None:
        company, _ = self.owner()
        member = self.member(company)
        older = self.kiosk_acquisition(1)
        _, current = self.kiosk(2, [self.component("-7")])
        self.connection.commit()
        first = self.revisions(member)
        self.kiosk(1, [self.component("-9")], acquisition_id=older, expected=current)
        self.assertEqual(self.revisions(member), first)
        self.connection.commit()
        historical = self.revisions(member)
        self.assertNotEqual(historical["data_kiosk"], first["data_kiosk"])
        self.assertEqual(historical["settlement"], first["settlement"])
        self.assertEqual(historical["fees"], first["fees"])
        self.assertEqual(
            self.connection.execute(
                "select current_version_id::text from private.data_kiosk_days"
            ).fetchone(),
            (current,),
        )
        self.kiosk(3, [], expected=current)
        self.connection.commit()
        second = self.revisions(member)
        self.assertNotEqual(second["data_kiosk"], historical["data_kiosk"])
        self.assertEqual(second["settlement"], first["settlement"])

    def test_pruning_rotates_source_token_only_when_history_is_removed(self) -> None:
        company, _ = self.owner()
        operator, member = self.operator(), self.member(company)
        current = None
        for observation in range(1, 5):
            _, current = self.kiosk(observation, [self.component()], expected=current)
        self.connection.commit()
        initial = self.revisions(operator)
        self.assertEqual(self.revisions(member)["data_kiosk"], initial["data_kiosk"])
        self.assertEqual(
            self.connection.execute("select private.prune_data_kiosk_preprocess()").fetchone(),
            (1,),
        )
        self.assertEqual(self.revisions(operator), initial)
        self.connection.commit()
        pruned = self.revisions(operator)
        self.assertNotEqual(pruned["data_kiosk"], initial["data_kiosk"])
        self.assertEqual(pruned["settlement"], initial["settlement"])
        self.assertEqual(pruned["fees"], initial["fees"])
        self.assertEqual(self.revisions(member)["data_kiosk"], pruned["data_kiosk"])
        self.assertEqual(
            self.as_user(operator, "select count(*) from public.data_kiosk_preprocess_entries"),
            [(3,)],
        )
        self.assertEqual(
            self.connection.execute("select private.prune_data_kiosk_preprocess()").fetchone(),
            (0,),
        )
        self.connection.commit()
        self.assertEqual(self.revisions(operator), pruned)

    def test_source_tokens_are_global_but_fees_are_company_scoped(self) -> None:
        company_a, sku_a = self.owner()
        company_b, _ = self.owner("OTHER")
        member_a, member_b, operator = (
            self.member(company_a),
            self.member(company_b),
            self.operator(),
        )
        self.connection.commit()
        first_a, first_b, first_admin = (
            self.revisions(member_a),
            self.revisions(member_b),
            self.revisions(operator),
        )
        self.fee(sku_a, [("2026-01-01", None, "5")])
        self.connection.commit()
        self.assertNotEqual(self.revisions(member_a)["fees"], first_a["fees"])
        self.assertEqual(self.revisions(member_b), first_b)
        self.assertNotEqual(self.revisions(operator)["fees"], first_admin["fees"])
        self.settlement([self.transaction("9")])
        self.connection.commit()
        self.assertEqual(
            self.revisions(member_a)["settlement"], self.revisions(member_b)["settlement"]
        )
        self.assertNotEqual(self.revisions(member_b)["settlement"], first_b["settlement"])

    def test_fee_transfer_and_company_rename_notify_previous_and_new_owners(self) -> None:
        company_a, sku_a = self.owner()
        company_b, _ = self.owner("OTHER")
        member_a, member_b = self.member(company_a), self.member(company_b)
        self.connection.commit()
        first_a, first_b = self.revisions(member_a), self.revisions(member_b)
        current = require_row(
            self.connection.execute(
                "select current_terms_version_id from public.skus where id=%s", (sku_a,)
            ).fetchone()
        )
        self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": sku_a,
                "sku": "SKU",
                "company_id": company_b,
                "expected_current_version_id": str(current[0]),
                "change_reason": "Transfer",
                "periods": [],
            },
        )
        self.connection.commit()
        self.assertNotEqual(self.revisions(member_a)["fees"], first_a["fees"])
        self.assertNotEqual(self.revisions(member_b)["fees"], first_b["fees"])
        before_rename_a, before_rename_b = self.revisions(member_a), self.revisions(member_b)
        self.connection.execute(
            "update public.companies set name='Renamed' where id=%s", (company_b,)
        )
        self.connection.commit()
        self.assertEqual(self.revisions(member_a), before_rename_a)
        self.assertNotEqual(self.revisions(member_b)["fees"], before_rename_b["fees"])

    def test_rolled_back_publication_does_not_change_token(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        self.connection.commit()
        initial = self.revisions(member)
        self.settlement([self.transaction("8")])
        self.connection.execute("set constraints all immediate")
        self.assertNotEqual(self.revisions(member), initial)
        self.connection.rollback()
        self.assertEqual(self.revisions(member), initial)

    def test_multiple_publications_in_one_commit_share_one_change_token(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        self.connection.commit()
        self.settlement([self.transaction("8")], identity="one")
        self.connection.execute("set constraints private.workspace_settlement_revision immediate")
        first = self.revisions(member)["settlement"]
        self.settlement([self.transaction("9")], identity="two")
        self.assertEqual(self.revisions(member)["settlement"], first)
        self.connection.commit()
        self.assertEqual(self.revisions(member)["settlement"], first)
        self.settlement([self.transaction("10")], identity="three")
        self.connection.commit()
        self.assertNotEqual(self.revisions(member)["settlement"], first)

    def test_polling_does_not_read_fact_rows(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        self.settlement([self.transaction("8")])
        self.kiosk(1, [self.component("-2")])
        self.connection.commit()
        before = self.connection.execute(_FACT_STATS).fetchall()
        self.poll(member)
        after = self.connection.execute(_FACT_STATS).fetchall()
        self.assertEqual(after, before)
