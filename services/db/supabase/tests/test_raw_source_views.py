"""Administrators read the current version of each Raw data source; nobody else does."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import LiteralString

import psycopg
from psycopg import sql

from services.db.supabase.tests.reference_fixture import ReferenceFixture

_COUNTS: LiteralString = """select
    (select count(*) from public.current_ad_invoices),
    (select count(*) from public.current_ad_invoice_lines),
    (select count(*) from public.current_storage_rows),
    (select count(*) from public.current_aged_storage_rows),
    (select count(*) from public.current_removal_order_rows)"""
_COLUMNS: LiteralString = """select a.attname::text, format_type(a.atttypid, a.atttypmod)
    from pg_attribute as a
    where a.attrelid = to_regclass('public.' || %s) and a.attnum > 0 and not a.attisdropped
    order by a.attnum"""

# The frontend contract: exact names in order. A column not named here is text.
_TYPES = {
    "id": "uuid",
    "version_id": "uuid",
    "processed_at": "timestamp with time zone",
    "snapshot_at": "timestamp with time zone",
    "requested_at": "timestamp with time zone",
    "last_updated_at": "timestamp with time zone",
    "row_number": "integer",
    "line_number": "integer",
    "line_count": "integer",
    **dict.fromkeys(
        (
            "invoice_date",
            "from_date",
            "to_date",
            "month_of_charge",
            "snapshot_month",
            "request_date",
            "ledger_first_month",
            "ledger_last_month",
        ),
        "date",
    ),
    **dict.fromkeys(
        (
            "amount_due",
            "tax_amount_due",
            "tax_rate_stated",
            "tax_rate_percent",
            "cost_amount",
            "fee_amount",
            "base_amount",
            "tax_amount",
            "quantity_charged",
            "average_quantity_on_hand",
            "estimated_total_item_volume",
            "storage_rate",
            "base_rate",
            "utilization_surcharge_rate",
            "est_vol_for_sus",
            "est_base_msf",
            "est_sus",
            "requested_quantity",
            "cancelled_quantity",
            "disposed_quantity",
            "shipped_quantity",
            "in_process_quantity",
        ),
        "numeric",
    ),
}
_SOURCE = "id seller_namespace amazon_scope version_id processed_at"
_AMOUNTS = "currency fee_amount base_amount tax_amount ledger_first_month ledger_last_month"
_CONTRACT = {
    "current_ad_invoices": f"{_SOURCE} invoice_id profile_id marketplace_name invoice_status "
    "invoice_date from_date to_date currency amount_due tax_amount_due tax_name tax_country "
    "tax_rate_stated tax_rate_percent line_count",
    "current_ad_invoice_lines": "id version_id line_number line_kind adjustment_kind campaign_id "
    "campaign_aid campaign_name ad_program description currency cost_amount base_amount "
    "tax_amount",
    "current_storage_rows": f"{_SOURCE} row_number month_of_charge marketplace_name country_code "
    "fulfillment_center fnsku asin average_quantity_on_hand product_size_tier "
    "estimated_total_item_volume volume_units storage_rate base_rate utilization_surcharge_rate "
    f"storage_utilization_ratio est_vol_for_sus est_base_msf est_sus {_AMOUNTS}",
    "current_aged_storage_rows": f"{_SOURCE} row_number snapshot_at snapshot_month "
    "marketplace_name country_code fnsku asin sku_printed condition age_tier quantity_charged "
    f"{_AMOUNTS}",
    "current_removal_order_rows": f"{_SOURCE} row_number removal_order_id requested_at "
    "request_date last_updated_at order_type order_status fnsku sku_printed disposition "
    "requested_quantity cancelled_quantity disposed_quantity shipped_quantity "
    f"in_process_quantity {_AMOUNTS}",
}

_STOCK = {
    "fnsku": "X000000001",
    "currency": "USD",
    "tax_amount": "0",
    "ledger_first_month": "2026-01-01",
    "ledger_last_month": "2026-01-01",
}
_STORED = _STOCK | {"country_code": "US", "marketplace_name": "Amazon.com", "asin": "B000000001"}


def _storage(fee: str, **fields: str | None) -> dict[str, str | None]:
    return (
        _STORED | {"month_of_charge": "2026-01-01", "fee_amount": fee, "base_amount": fee} | fields
    )


_REMOVAL: dict[str, str | None] = _STOCK | {
    "removal_order_id": "REMOVAL-1",
    # 23:30 in Los Angeles is the next UTC day.
    "requested_at": "2026-01-31T23:30:00-08:00",
    "last_updated_at": "2026-02-02T00:00:00Z",
    "order_type": "Disposal",
    "order_status": "Completed",
    "sku_printed": "SKU-A",
    "requested_quantity": "2",
    "disposed_quantity": "2",
    "fee_amount": "1.10",
    "base_amount": "1.10",
    "ledger_last_month": "2026-02-01",
}

# Some reports state one storage rate instead of the fixture's base and surcharge rates.
_ONE_RATE = {"storage_rate": "13.2", "base_rate": None, "utilization_surcharge_rate": None}


def _line(kind: str, cost: str, **fields: str) -> dict[str, str]:
    return {"line_kind": kind, "cost_amount": cost, "base_amount": cost, "tax_amount": "0"} | fields


class RawSourceViewTests(ReferenceFixture):
    def setUp(self) -> None:
        super().setUp()
        later = self.observed_at + timedelta(days=1)
        self.reference("STORAGE", "2026-01", [_storage("1.00")])
        self.storage_version = self.reference(
            "STORAGE",
            "2026-01",
            [
                _storage("2.50"),
                _storage(
                    "0.0002",
                    country_code="CA",
                    marketplace_name="Amazon.ca",
                    volume_units="cubic meters",
                    estimated_total_item_volume="8.0E-4",
                    **_ONE_RATE,
                ),
            ],
            when=later,
        )
        self.aged_version = self.reference(
            "AGED_STORAGE",
            "2026-01",
            [
                _STORED
                | {
                    "snapshot_at": "2026-01-15T08:00:00Z",
                    "snapshot_month": "2026-01-01",
                    "sku_printed": "SKU-A",
                    "condition": "New",
                    "age_tier": "365+",
                    "quantity_charged": "3",
                    "fee_amount": "0.36",
                    "base_amount": "0.36",
                }
            ],
        )
        self.removal_version = self.reference("REMOVAL_ORDER", "REMOVAL-1", [_REMOVAL])
        self.reference(
            "AD_INVOICE",
            "INVOICE-1",
            [_line("CAMPAIGN", "5", campaign_id="C1", ad_program="SPONSORED_PRODUCTS")],
        )
        self.invoice_version = self.reference(
            "AD_INVOICE",
            "INVOICE-1",
            [
                _line("CAMPAIGN", "4", campaign_id="C1", ad_program="SPONSORED_PRODUCTS"),
                _line(
                    "ACCOUNT_ADJUSTMENT",
                    "1",
                    adjustment_kind="ROUNDING",
                    description="Rounding Adjustment",
                ),
            ],
            when=later,
        )
        self.administrator = self.account("administrator")

    def test_administrator_reads_only_current_versions(self) -> None:
        read, admin = self.as_user, self.administrator
        # The superseded storage month and invoice keep their rows.
        self.assertEqual(
            self.connection.execute(
                "select count(*),(select count(*) from private.ad_invoice_lines) "
                "from private.storage_rows"
            ).fetchall(),
            [(3, 3)],
        )
        self.assertEqual(read(admin, _COUNTS), [(1, 2, 2, 1, 1)])
        self.assertEqual(
            read(
                admin,
                "select version_id,marketplace_name,fee_amount,base_amount "
                "from public.current_storage_rows order by marketplace_name",
            ),
            [
                (self.storage_version, "Amazon.ca", Decimal("0.0002"), Decimal("0.0002")),
                (self.storage_version, "Amazon.com", Decimal("2.50"), Decimal("2.50")),
            ],
        )
        # Amazon's figures behind each fee, in either rate form, as the report printed them.
        self.assertEqual(
            read(
                admin,
                "select average_quantity_on_hand,product_size_tier,estimated_total_item_volume,"
                "volume_units,storage_rate,base_rate,utilization_surcharge_rate "
                "from public.current_storage_rows order by marketplace_name",
            ),
            [
                (
                    2,
                    "Standard-Size",
                    Decimal("0.00080"),
                    "cubic meters",
                    Decimal("13.2"),
                    None,
                    None,
                ),
                (2, "Standard-Size", Decimal("0.5"), "cubic feet", None, Decimal("0.78"), 0),
            ],
        )
        # Only a two-rate row carries the utilization ratio and Amazon's split of the fee.
        self.assertEqual(
            read(
                admin,
                "select storage_utilization_ratio,est_vol_for_sus,est_base_msf,est_sus "
                "from public.current_storage_rows order by marketplace_name",
            ),
            [(None, None, None, None), ("9.2", 0, Decimal("2.50"), 0)],
        )
        self.assertEqual(
            read(
                admin,
                "select id,version_id,invoice_id,seller_namespace,amazon_scope,line_count "
                "from public.current_ad_invoices",
            ),
            [(self.invoice_version, self.invoice_version, "INVOICE-1", self.seller, "NA", 2)],
        )
        self.assertEqual(
            read(
                admin,
                "select version_id,snapshot_month,age_tier,quantity_charged "
                "from public.current_aged_storage_rows",
            ),
            [(self.aged_version, date(2026, 1, 1), "365+", Decimal(3))],
        )
        processed = read(
            admin,
            "select r.processed_at,b.created_at from public.current_removal_order_rows as r "
            "join private.source_units as u on u.current_version_id = r.version_id "
            "join private.source_preprocess_batches as b on b.id = u.current_batch_id",
        )
        self.assertEqual(len(processed), 1)
        self.assertEqual(processed[0][0], processed[0][1])

    def test_invoice_lines_carry_their_invoice_currency(self) -> None:
        self.assertEqual(
            self.as_user(
                self.administrator,
                "select l.version_id,l.line_number,l.line_kind,l.adjustment_kind,l.campaign_id,"
                "l.cost_amount,l.currency,i.currency from public.current_ad_invoice_lines as l "
                "join public.current_ad_invoices as i using (version_id) order by l.line_number",
            ),
            [
                (self.invoice_version, 1, "CAMPAIGN", None, "C1", Decimal(4), "USD", "USD"),
                (
                    self.invoice_version,
                    2,
                    "ACCOUNT_ADJUSTMENT",
                    "ROUNDING",
                    None,
                    Decimal(1),
                    "USD",
                    "USD",
                ),
            ],
        )

    def test_removal_request_date_is_the_utc_day(self) -> None:
        self.assertEqual(
            self.as_user(
                self.administrator,
                "select version_id,requested_at,request_date,requested_quantity,disposed_quantity "
                "from public.current_removal_order_rows",
            ),
            [
                (
                    self.removal_version,
                    datetime(2026, 2, 1, 7, 30, tzinfo=UTC),
                    date(2026, 2, 1),
                    Decimal(2),
                    Decimal(2),
                )
            ],
        )

    def test_members_read_no_rows_and_anonymous_callers_are_denied(self) -> None:
        for user in (self.account("member", self.company), self.account("unassigned")):
            with self.subTest(user=user):
                self.assertEqual(self.as_user(user, _COUNTS), [(0, 0, 0, 0, 0)])
        for view in _CONTRACT:
            with (
                self.subTest(view=view),
                self.assertRaises(psycopg.errors.InsufficientPrivilege),
                self.connection.transaction(),
            ):
                self.connection.execute("set local role anon")
                self.connection.execute(
                    sql.SQL("select * from {}").format(sql.Identifier("public", view))
                )

    def rejected(self, source: str, key: str, row: dict[str, str | None], **options: str) -> None:
        """A check constraint refuses the row. A stored row is immutable, so each case inserts."""
        with (
            self.assertRaisesRegex(psycopg.errors.CheckViolation, "violates check constraint"),
            self.connection.transaction(),
        ):
            self.reference(source, key, [row], **options)

    def test_storage_rows_state_exactly_one_rate_form(self) -> None:
        for rates in (
            {"storage_rate": "1"},
            {"base_rate": None, "utilization_surcharge_rate": None},
            {"utilization_surcharge_rate": None},
        ):
            with self.subTest(rates=rates):
                self.rejected("STORAGE", "2026-01", _storage("1.00", **rates))

    def test_two_rate_storage_rows_split_their_fee(self) -> None:
        for split in (
            {"est_sus": None},
            {"storage_utilization_ratio": None},
            {"storage_utilization_ratio": "52+"},
            {"est_base_msf": "2.4998"},
            {"est_sus": "0.0002"},
            {"est_vol_for_sus": "-1"},
        ):
            with self.subTest(split=split):
                self.rejected("STORAGE", "2026-01", _storage("2.50", **split))
        # A one-rate row has no split.
        self.rejected("STORAGE", "2026-01", _storage("1.00", **_ONE_RATE, est_sus="0"))
        # Amazon rounds the two parts separately: they may miss the fee by 0.0001.
        rounded = _storage("2.50", est_base_msf="2.4999", storage_utilization_ratio=">52")
        self.reference("STORAGE", "2026-01", [rounded])

    def test_removal_rows_state_the_quantity_of_their_order_type(self) -> None:
        for quantities in (
            {"disposed_quantity": None},
            {"shipped_quantity": "2"},
            {"order_type": "Return"},
            {"order_type": "Liquidations"},
        ):
            with self.subTest(quantities=quantities):
                self.rejected("REMOVAL_ORDER", "REMOVAL-2", _REMOVAL | quantities)
        for order_type in ("Return", "Liquidations"):
            shipped = {"order_type": order_type, "disposed_quantity": None, "shipped_quantity": "2"}
            self.reference("REMOVAL_ORDER", "REMOVAL-" + order_type, [_REMOVAL | shipped])

    def test_invoices_hold_only_observed_statuses(self) -> None:
        for status in ("ISSUED", "PAID_IN_PART", "paid_in_full"):
            with self.subTest(status=status):
                self.rejected("AD_INVOICE", "INVOICE-2", _line("CAMPAIGN", "5"), status=status)

    def test_columns_follow_the_frontend_contract(self) -> None:
        for view, names in _CONTRACT.items():
            with self.subTest(view=view):
                expected = [(name, _TYPES.get(name, "text")) for name in names.split()]
                self.assertEqual(self.connection.execute(_COLUMNS, (view,)).fetchall(), expected)
