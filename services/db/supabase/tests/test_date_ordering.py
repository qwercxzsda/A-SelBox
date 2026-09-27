"""One source date index supports fully reversed, stable paginated date orders."""

from itertools import product
from typing import cast

from services.db.supabase.tests import test_source_transaction_page as source_fixture
from services.db.supabase.tests import test_transaction_page as live_fixture
from services.db.supabase.tests.source_fixtures import SourceModelFixture


class DateOrderingTests(SourceModelFixture):
    live_page = live_fixture.TransactionPageTests.page
    source_page = source_fixture.SourceTransactionPageTests.page
    expected_live = live_fixture.TransactionPageTests.expected
    expected_source = source_fixture.SourceTransactionPageTests.expected

    def page(self, user: str, dataset: str, **options: object) -> dict[str, object]:
        if dataset == "live":
            return self.live_page(user, **options)
        return self.source_page(user, dataset, **options)

    def expected(self, user: str, dataset: str, **options: object) -> dict[str, object]:
        if dataset == "live":
            return self.expected_live(user, **options)
        return self.expected_source(user, dataset, **options)

    def tied_rows(self) -> tuple[str, str]:
        company_a, sku_a = self.owner()
        company_b, sku_b = self.owner("OTHER")
        self.fee(sku_a, [("2026-01-01", None, "5")])
        self.fee(sku_b, [("2026-01-01", None, "7")])
        settlement = [
            self.transaction(
                "10",
                index + 3,
                activity_date=f"2026-06-{14 + index % 3:02d}",
                sku="SKU" if index % 2 else "OTHER",
            )
            for index in range(12)
        ]
        kiosk = [self.component("10", sku="SKU" if index % 2 else "OTHER") for index in range(10)]
        # A source row ID may occur in both tables. The source key must reverse
        # together with the ID and date, rather than treating IDs as global.
        kiosk[1]["id"] = settlement[1]["id"]
        self.settlement(settlement)
        self.kiosk(1, kiosk)
        return company_a, company_b

    def test_date_directions_are_exact_reverses_for_all_datasets_and_roles(self) -> None:
        company_a, company_b = self.tied_rows()
        for user, dataset in product(
            (self.operator(), self.member(company_a), self.member(company_b), self.auth_user()),
            ("live", "settlement", "data_kiosk"),
        ):
            with self.subTest(user=user, dataset=dataset):
                ascending = self.page(user, dataset, p_direction="asc", p_limit=1000)
                descending = self.page(user, dataset, p_direction="desc", p_limit=1000)
                self.assertEqual(
                    ascending, self.expected(user, dataset, p_direction="asc", p_limit=1000)
                )
                self.assertEqual(
                    descending, self.expected(user, dataset, p_direction="desc", p_limit=1000)
                )
                rows = cast(list[object], ascending["rows"])
                self.assertEqual(descending["rows"], list(reversed(rows)))
                self.assertEqual(ascending["total_count"], descending["total_count"])
                for direction, size in product(("asc", "desc"), (1, 4, 7)):
                    paged: list[object] = []
                    for offset in range(0, len(rows) + size, size):
                        response = self.page(
                            user,
                            dataset,
                            p_direction=direction,
                            p_limit=size,
                            p_offset=offset,
                            p_include_count=False,
                        )
                        self.assertIsNone(response["total_count"])
                        paged.extend(cast(list[object], response["rows"]))
                    self.assertEqual(paged, rows if direction == "asc" else list(reversed(rows)))

    def test_search_and_filters_keep_reverse_order_but_amount_ties_stay_ascending(self) -> None:
        company_a, _ = self.tied_rows()
        for user, dataset in product(
            (self.operator(), self.member(company_a)), ("live", "settlement", "data_kiosk")
        ):
            with self.subTest(user=user, dataset=dataset):
                filters = {
                    "p_date_from": "2026-06-15",
                    "p_date_to": "2026-06-15",
                    "p_skus": ["SKU"],
                    "p_marketplaces": ["Amazon.com"],
                    "p_search_skus": ["SKU"],
                }
                ascending = self.page(user, dataset, p_direction="asc", **filters)
                descending = self.page(user, dataset, p_direction="desc", **filters)
                self.assertEqual(
                    descending["rows"], list(reversed(cast(list[object], ascending["rows"])))
                )
                for direction in ("asc", "desc"):
                    self.assertEqual(
                        self.page(
                            user, dataset, p_direction=direction, p_limit=2, p_offset=1, **filters
                        ),
                        self.expected(
                            user, dataset, p_direction=direction, p_limit=2, p_offset=1, **filters
                        ),
                    )
                # Every fixture amount is 10. Changing the amount direction
                # must therefore preserve the original ascending source/ID ties.
                amounts_asc = self.page(user, dataset, p_order_by="amount", p_direction="asc")
                amounts_desc = self.page(user, dataset, p_order_by="amount", p_direction="desc")
                self.assertEqual(amounts_asc, amounts_desc)
                self.assertEqual(
                    amounts_desc,
                    self.expected(user, dataset, p_order_by="amount", p_direction="desc"),
                )

    def test_each_source_has_one_ascending_date_id_index(self) -> None:
        indexes = self.connection.execute(
            "select c.relname,pg_get_indexdef(i.indexrelid,1,true),"
            "pg_get_indexdef(i.indexrelid,2,true),i.indoption::text,"
            "pg_get_expr(i.indpred,i.indrelid) "
            "from pg_index i join pg_class c on c.oid=i.indexrelid "
            "where c.relnamespace='private'::regnamespace and c.relname in "
            "('settlement_transactions_date_id_idx','data_kiosk_transactions_date_id_idx') "
            "order by c.relname"
        ).fetchall()
        self.assertEqual(len(indexes), 2)
        self.assertEqual(
            indexes[0], ("data_kiosk_transactions_date_id_idx", "activity_date", "id", "0 0", None)
        )
        self.assertEqual(
            indexes[1], ("settlement_transactions_date_id_idx", "posted_date", "id", "0 0", None)
        )
        self.assertEqual(
            self.connection.execute(
                "select bool_and(attnotnull) from pg_attribute where "
                "(attrelid='private.settlement_transactions'::regclass and attname='posted_date') "
                "or (attrelid='private.data_kiosk_transactions'::regclass "
                "and attname='activity_date')"
            ).fetchone(),
            (True,),
        )
