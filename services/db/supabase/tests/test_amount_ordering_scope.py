"""Raw-amount ordering is bounded after visibility, filters, and literal search."""

from itertools import product
from typing import cast

import psycopg

from services.db.supabase.tests import test_source_transaction_page as source_fixture
from services.db.supabase.tests import test_transaction_count as count_fixture
from services.db.supabase.tests import test_transaction_page as page_fixture
from services.db.supabase.tests.source_fixtures import SourceModelFixture

_AMOUNT_SCOPE_MESSAGE = (
    "Amount ordering is limited to 10,000 matching transactions. "
    "Narrow your filters or order by date."
)


class AmountOrderingScopeTests(SourceModelFixture):
    live_page = page_fixture.TransactionPageTests.page
    source_page = source_fixture.SourceTransactionPageTests.page
    live_count = count_fixture.TransactionCountTests.count

    def test_all_tabs_enforce_the_cap_after_visibility_filters_and_search(self) -> None:
        company, sku = self.owner()
        other_company, _ = self.owner("OTHER")
        self.fee(sku, [("2026-01-01", None, "5")])
        member, other_member, operator = (
            self.member(company),
            self.member(other_company),
            self.operator(),
        )
        settlement_rows = [self.transaction(str(i), i + 2) for i in range(1, 10001)]
        settlement_rows.append(
            self.transaction("10001", 10003, sku="OTHER") | {"component_type": "FOCUS"}
        )
        kiosk_rows = [self.component(str(i)) for i in range(1, 10001)]
        kiosk_rows.append(self.component("10001", sku="OTHER") | {"component_type": "FOCUS"})
        kiosk_rows.append(self.component("0"))
        self.settlement(settlement_rows)
        self.kiosk(1, kiosk_rows)

        for dataset, direction, include_count in product(
            ("settlement", "data_kiosk"), ("asc", "desc"), (False, True)
        ):
            with self.subTest(dataset=dataset, direction=direction, include_count=include_count):
                options = {
                    "p_order_by": "amount",
                    "p_direction": direction,
                    "p_limit": 2,
                    "p_include_count": include_count,
                }
                for live in (False, True):
                    with self.assertRaises(psycopg.errors.InvalidParameterValue) as raised:
                        if live:
                            self.live_page(operator, p_sources=[dataset.upper()], **options)
                        else:
                            self.source_page(operator, dataset, **options)
                    self.assertEqual(raised.exception.diag.message_primary, _AMOUNT_SCOPE_MESSAGE)
                # Exact 10,000-row membership is accepted; another company's
                # visible row cannot consume this member's sort budget.
                source = self.source_page(member, dataset, **options)
                live = self.live_page(member, p_sources=[dataset.upper()], **options)
                expected_count = "10000" if include_count else None
                self.assertEqual(source["total_count"], expected_count)
                self.assertEqual(live["total_count"], expected_count)
                expected_amounts = ["1", "2"] if direction == "asc" else ["10000", "9999"]
                self.assertEqual(
                    [r["amount"] for r in cast(list[dict[str, object]], source["rows"])],
                    expected_amounts,
                )
                self.assertEqual(
                    [r["source_amount"] for r in cast(list[dict[str, object]], live["rows"])],
                    expected_amounts,
                )
                # Offsets do not turn a broad amount sort into an eligible one.
                with self.assertRaises(psycopg.errors.InvalidParameterValue):
                    self.source_page(operator, dataset, p_offset=20000, **options)
                tail = self.source_page(member, dataset, p_offset=9999, **options)
                self.assertEqual(len(cast(list[object], tail["rows"])), 1)

        for dataset in ("settlement", "data_kiosk"):
            source = dataset.upper()
            filters = (
                {"p_skus": ["OTHER"]},
                {"p_types": ["FOCUS"]},
                {"p_search": "OTHER"},
                {"p_search": "no such visible text"},
                {"p_date_from": "2026-07-01"},
                {"p_marketplaces": ["Amazon.co.uk"]},
            )
            for selection in filters:
                with self.subTest(dataset=dataset, selection=selection):
                    raw = self.source_page(operator, dataset, p_order_by="amount", **selection)
                    live = self.live_page(
                        operator, p_sources=[source], p_order_by="amount", **selection
                    )
                    expected_count = (
                        "1"
                        if any(key in selection for key in ("p_skus", "p_types"))
                        or selection.get("p_search") == "OTHER"
                        else "0"
                    )
                    self.assertEqual(raw["total_count"], expected_count)
                    self.assertEqual(live["total_count"], expected_count)
            self.assertEqual(
                self.source_page(other_member, dataset, p_order_by="amount")["total_count"], "1"
            )
            # Date pages and exact counts stay available above the amount cap.
            for direction in ("asc", "desc"):
                self.assertEqual(
                    self.source_page(operator, dataset, p_direction=direction)["total_count"],
                    "10001",
                )
                self.assertEqual(
                    self.live_page(operator, p_sources=[source], p_direction=direction)[
                        "total_count"
                    ],
                    "10001",
                )
                self.assertEqual(self.live_count(operator, p_sources=[source]), "10001")

        # The limit covers the combined Transactions result, not each source.
        with self.assertRaises(psycopg.errors.InvalidParameterValue):
            self.live_page(member, p_order_by="amount")
        selected = self.live_page(operator, p_order_by="amount", p_search="FOCUS")
        self.assertEqual(selected["total_count"], "2")
        self.assertEqual(self.live_page(operator)["total_count"], "20002")
        self.assertEqual(self.live_count(operator), "20002")
        # The cap check runs before any monetary projection. It returns the
        # allowlisted overflow error, even if fee calculation would fail.
        self.connection.execute(
            "create or replace function private.calculate_service_fee("
            "p_fee_base numeric,p_fee_rate_percent numeric) returns numeric "
            "language plpgsql immutable as $$ begin "
            "raise exception 'Fee projection must not execute'; end; $$"
        )
        with self.assertRaises(psycopg.errors.InvalidParameterValue) as raised:
            self.live_page(operator, p_order_by="amount")
        self.assertEqual(raised.exception.diag.message_primary, _AMOUNT_SCOPE_MESSAGE)
