"""Inventory polling reads a token, never capture headers or SKU facts."""

from typing import cast

from services.db.supabase.tests.inventory_fixtures import InventoryFixture

_INVENTORY_STATS = (
    "select relname,seq_scan,seq_tup_read,idx_scan,idx_tup_fetch "
    "from pg_stat_xact_user_tables where relname in "
    "('inventory_acquisitions','inventory_daily_captures','inventory_items') order by relname"
)


class InventoryRevisionTests(InventoryFixture):
    def revisions(self, user: str) -> dict[str, str]:
        response = self.as_user(user, "select public.workspace_revisions()")[0][0]
        return cast(dict[str, str], cast(dict[str, object], response)["revisions"])

    def test_only_committed_capture_publication_rotates_inventory_token(self) -> None:
        company, _ = self.owner()
        member, operator = self.member(company), self.operator()
        self.connection.commit()
        initial = self.revisions(member)
        self.assertEqual(set(initial), {"settlement", "data_kiosk", "fees", "inventory"})
        self.assertEqual(initial["inventory"], "0")
        acquisition = self.acquire()
        self.connection.commit()
        self.assertEqual(self.revisions(member), initial)
        capture = self.capture(acquisition, [self.item()])
        self.assertEqual(self.revisions(member), initial)
        self.connection.commit()
        published = self.revisions(member)
        self.assertNotEqual(published["inventory"], initial["inventory"])
        self.assertEqual(
            {key: value for key, value in published.items() if key != "inventory"},
            {key: value for key, value in initial.items() if key != "inventory"},
        )
        self.assertEqual(self.revisions(operator)["inventory"], published["inventory"])
        self.assertEqual(self.capture(acquisition, [self.item()]), capture)
        self.connection.commit()
        self.assertEqual(self.revisions(member), published)
        later = self.acquire(report_created_at="2026-09-29T13:00:00Z")
        self.capture(later, [], expected=capture)
        self.connection.commit()
        self.assertNotEqual(self.revisions(member)["inventory"], published["inventory"])

    def test_rollback_restores_token_and_capture_together(self) -> None:
        operator = self.operator()
        original = self.capture(self.acquire(), [self.item()])
        self.connection.commit()
        before = self.revisions(operator)
        with self.connection.transaction(force_rollback=True):
            later = self.acquire(report_created_at="2026-09-29T13:00:00Z")
            self.capture(later, [], expected=original)
            self.connection.execute("set constraints all immediate")
            self.assertNotEqual(self.revisions(operator)["inventory"], before["inventory"])
        self.assertEqual(self.revisions(operator), before)
        self.assertEqual(
            self.connection.execute("select count(*) from private.inventory_items").fetchone(),
            (1,),
        )

    def test_multiple_captures_in_one_commit_share_token(self) -> None:
        operator = self.operator()
        self.connection.commit()
        first = self.capture(self.acquire(), [self.item()])
        self.connection.execute("set constraints private.workspace_inventory_revision immediate")
        first_token = self.revisions(operator)["inventory"]
        later = self.acquire(report_created_at="2026-09-29T13:00:00Z")
        self.capture(later, [self.item(quantity=3)], expected=first)
        self.assertEqual(self.revisions(operator)["inventory"], first_token)
        self.connection.commit()
        self.assertEqual(self.revisions(operator)["inventory"], first_token)

    def test_unchanged_polls_never_scan_inventory_headers_or_facts(self) -> None:
        company, _ = self.owner()
        member = self.member(company)
        self.capture(self.acquire(), [self.item()])
        self.connection.commit()
        before_stats = self.connection.execute(_INVENTORY_STATS).fetchall()
        before = self.revisions(member)
        self.assertEqual(self.revisions(member), before)
        self.assertEqual(self.connection.execute(_INVENTORY_STATS).fetchall(), before_stats)
