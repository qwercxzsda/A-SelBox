"""Exercise attribution, issue dates, source versioning and payout access in PostgreSQL."""

from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import LiteralString, cast
from uuid import UUID, uuid7

from psycopg.types.json import Jsonb

from services.db.supabase.tests.integration_support import DatabaseTestCase
from services.db.supabase.tests.local_database import require_row

# Finances charges default to Amazon.com; the North American scope also covers these.
_MARKETPLACE_IDS = {"Amazon.com": "US", "Amazon.ca": "CA", "Amazon.com.mx": "MX"}
# Amazon's figures behind a monthly storage fee, in the North American rate form.
_STORAGE_BASIS = {
    "average_quantity_on_hand": "2",
    "product_size_tier": "Standard-Size",
    "estimated_total_item_volume": "0.5",
    "volume_units": "cubic feet",
    "base_rate": "0.78",
    "utilization_surcharge_rate": "0",
}


def _storage_row(row: Mapping[str, object]) -> dict[str, object]:
    """Complete a storage row; a two-rate row splits its fee into a base fee and no surcharge."""
    stored = {**_STORAGE_BASIS, **row}
    if stored["base_rate"] is None:
        return stored
    split = {
        "storage_utilization_ratio": "9.2",
        "est_vol_for_sus": "0",
        "est_base_msf": stored["fee_amount"],
        "est_sus": "0",
    }
    return {**split, **stored}


class ReferenceFixture(DatabaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.set_mature_cutoff_date(date(2026, 11, 1))
        self.company = self.one(
            "insert into public.companies(name) values ('Company A') returning id"
        )
        self.other = self.one(
            "insert into public.companies(name) values ('Company B') returning id"
        )
        self.seller = "test-seller"
        self.observed_at = datetime.now(UTC)

    def one(self, query: LiteralString, params: tuple[object, ...] = ()) -> object:
        row = self.connection.execute(query, params).fetchone()
        return require_row(row)[0]

    def account(self, role: str, company: object = None) -> str:
        """Create an Auth user with the given application role."""
        user = str(uuid7())
        self.connection.execute("insert into auth.users(id) values(%s)", (user,))
        self.connection.execute(
            "update public.app_accounts set access_role=%s,company_id=%s where user_id=%s",
            (role, company, user),
        )
        return user

    def as_user(
        self, user: str, query: LiteralString, params: tuple[object, ...] = ()
    ) -> list[tuple[object, ...]]:
        """Run one query as the user's authenticated role, then restore the owner."""
        with self.connection.transaction():
            self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
            self.connection.execute("set local role authenticated")
            rows = self.connection.execute(query, params).fetchall()
            self.connection.execute("reset role")
            return rows

    def assign_sku(self, sku: str, company: object, rate: int | None = None) -> object:
        payload = {
            "id": str(uuid7()),
            "sku_id": str(uuid7()),
            "sku": sku,
            "company_id": str(company),
            "change_reason": "Assign SKU",
            "periods": []
            if rate is None
            else [
                {
                    "id": str(uuid7()),
                    "marketplace_name": "Amazon.com",
                    "valid_from": "2025-01-01",
                    "valid_to": None,
                    "fee_rate_percent": rate,
                }
            ],
        }
        return self.one("select private.publish_sku_terms(%s)", (Jsonb(payload),))

    def reference(
        self,
        source: str,
        key: str,
        rows: Sequence[Mapping[str, object]],
        scope: str = "NA",
        when: datetime | None = None,
        marketplace: str = "Amazon.com",
        status: str = "PAID_IN_FULL",
    ) -> object:
        """Store one reference unit; campaign, promotion and invoice records name marketplace.

        An invoice also takes its status.
        """
        from services.sync.src.reference.acquisition import ReferenceRequest
        from services.sync.src.reference.store import store_information, store_unit

        named = source in {"CAMPAIGN", "AD_INVOICE", "PROMOTION", "SHIPMENT"}
        start = None if named else date(2026, 1, 1)
        end = None if named else date(2026, 2, 1)
        request = ReferenceRequest(
            source, scope, "ATVPDKIKX0DER", self.seller, start, end, key if named else None
        )
        acquisition, batch = uuid7(), uuid7()
        observed = when or self.observed_at
        info = source in {"CAMPAIGN", "PROMOTION", "SHIPMENT"}
        self.connection.execute(
            """insert into private.source_acquisitions(id,source,seller_namespace,amazon_scope,
                asked_from,
                asked_until,asked_id,result,capture_started_at,downloaded_at,api_metadata,documents)
                values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}','[{}]')""",
            (
                acquisition,
                source,
                self.seller,
                scope,
                start,
                end,
                request.native_id,
                "ROWS" if rows else "EMPTY",
                observed,
                observed,
            ),
        )
        self.connection.execute(
            "insert into private.source_preprocess_batches(id,acquisition_id,preprocess_version,"
            "unit_count,row_count) "
            "values(%s,%s,'1',%s,%s)",
            (batch, acquisition, int(not info), len(rows)),
        )
        with self.connection.cursor() as cursor:
            if info:
                record: dict[str, object] = {source.lower() + "_id": key}
                if source != "SHIPMENT":
                    record["marketplace_name"] = marketplace
                store_information(cursor, request, batch, record, rows, missing=False)
                return batch
            header: dict[str, object] = {}
            if source == "STORAGE":
                rows = [_storage_row(row) for row in rows]
            if source == "AD_INVOICE":
                header = {
                    "invoice_id": key,
                    "profile_id": "123",
                    "marketplace_name": marketplace,
                    "invoice_status": status,
                    "invoice_date": "2026-01-01",
                    "from_date": "2026-01-01",
                    "to_date": "2026-01-01",
                    "currency": "USD",
                    "amount_due": 5,
                    "tax_amount_due": 0,
                    "tax_rate_stated": 0,
                    "tax_rate_percent": 0,
                    "line_count": len(rows),
                }
            store_unit(cursor, request, batch, key, rows, header, 1)
        return self.one(
            "select version_id from private.source_batch_units where batch_id=%s", (batch,)
        )

    def finance(self, charges: list[dict[str, object]], *, seller: str | None = None) -> None:
        """Store each charge as one current Finances transaction of a North American account.

        A charge with an "amounts" list has one Finances amount per entry, each entry
        overriding the charge's own fields. Otherwise the charge is its only amount.
        """
        seller = seller or self.seller
        only: list[dict[str, object]] = [{}]
        transactions = [
            [
                charge | amount
                for amount in cast(list[dict[str, object]], charge.get("amounts", only))
            ]
            for charge in charges
        ]
        acquisition, batch = uuid7(), uuid7()
        self.connection.execute(
            """insert into private.source_acquisitions(id,source,seller_namespace,amazon_scope,
                api_version,capture_started_at,downloaded_at,asked_from,asked_until,result,
                reconciliation_start_date,reconciliation_end_date,marketplace_ids,api_metadata,documents)
            values(%s,'FINANCES',%s,'NA','2024-06-19',now(),now(),'2026-01-01','2026-03-01','ROWS',
                '2026-01-01','2026-02-28','{US}',
                '{"coverage_marketplaces":[{"marketplace_name":"Amazon.com"}]}','[{}]')""",
            (acquisition, seller),
        )
        self.connection.execute(
            "insert into private.source_preprocess_batches values(%s,%s,'1',%s,%s,now())",
            (batch, acquisition, len(transactions), sum(map(len, transactions))),
        )
        for number, amounts in enumerate(transactions, start=1):
            self._finance_transaction(seller, batch, number, amounts)
        self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all deferred")

    def _finance_transaction(
        self, seller: str, batch: UUID, number: int, amounts: list[dict[str, object]]
    ) -> None:
        native, version = uuid7(), uuid7()
        charge = amounts[0]
        posted = charge.get("date", "2026-01-15")
        marketplace = str(charge.get("marketplace", "Amazon.com"))
        self.connection.execute(
            """insert into private.source_units(id,source,seller_namespace,amazon_scope,
                unit_key)
                values(%s,'FINANCES',%s,'NA',%s)""",
            (native, seller, str(native)),
        )
        self.connection.execute(
            "insert into private.source_unit_versions(id,unit_id,source,content_sha256,"
            "row_count)"
            " values (%s,%s,'FINANCES',decode(repeat('aa',32),'hex'),%s)",
            (version, native, len(amounts)),
        )
        self.connection.execute(
            """insert into private.finances_transactions(version_id,
                posted_date,posted_at,marketplace_id,marketplace_name,customer_order_id,account_type,
                transaction_type,transaction_status,is_activity,total_amount,currency,amount_count)
                values(%s,%s,%s,%s,%s,%s,'Standard','Test','RELEASED',%s,%s,'USD',%s)""",
            (
                version,
                posted,
                charge.get("instant", posted),
                _MARKETPLACE_IDS[marketplace],
                marketplace,
                charge.get("order"),
                charge.get("is_activity", True),
                sum(Decimal(str(amount["amount"])) for amount in amounts),
                len(amounts),
            ),
        )
        for amount_number, amount in enumerate(amounts, start=1):
            self.connection.execute(
                """insert into private.finances_amounts(version_id,amount_number,selbox_group,
                    amount_type,
                    route,amount_part,sku,asin,fnsku,reference_id,covered_month,ledger_first_month,ledger_last_month,
                    fee_base,amount,breakdown_path,item_index,breakdown_indexes)
                    values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}',0,'{}')""",
                (
                    version,
                    amount_number,
                    amount.get("group", "ACCOUNT_FEE") if amount["route"] == "SELBOX" else None,
                    amount.get("type", "EXPENSE"),
                    amount["route"],
                    amount.get("part", "BASE"),
                    amount.get("sku"),
                    amount.get("asin"),
                    amount.get("fnsku"),
                    amount.get("key"),
                    amount.get("month"),
                    amount.get("start"),
                    amount.get("end"),
                    amount.get("fee_base"),
                    amount["amount"],
                ),
            )
        self.connection.execute(
            "insert into private.source_batch_units values(%s,%s,%s,1,%s)",
            (batch, native, version, number),
        )
        self.connection.execute(
            "update private.source_units set current_version_id=%s,current_batch_id=%s where id=%s",
            (version, batch, native),
        )
