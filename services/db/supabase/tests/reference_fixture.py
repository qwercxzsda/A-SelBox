"""Exercise attribution, issue dates, source versioning and payout access in PostgreSQL."""

from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from typing import LiteralString
from uuid import uuid7

from psycopg.types.json import Jsonb

from services.db.supabase.tests.integration_support import DatabaseTestCase
from services.db.supabase.tests.local_database import require_row


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
    ) -> object:
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
                store_information(
                    cursor, request, batch, {source.lower() + "_id": key}, rows, missing=False
                )
                return batch
            header: dict[str, object] = {}
            if source == "AD_INVOICE":
                header = {
                    "invoice_id": key,
                    "profile_id": "123",
                    "marketplace_name": "Amazon.com",
                    "invoice_status": "PAID",
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

    def finance(self, charges: list[dict[str, object]]) -> None:
        acquisition, batch = uuid7(), uuid7()
        self.connection.execute(
            """insert into private.source_acquisitions(id,source,seller_namespace,amazon_scope,
                api_version,capture_started_at,downloaded_at,asked_from,asked_until,result,
                reconciliation_start_date,reconciliation_end_date,marketplace_ids,api_metadata,documents)
            values(%s,'FINANCES',%s,'NA','2024-06-19',now(),now(),'2026-01-01','2026-03-01','ROWS',
                '2026-01-01','2026-02-28','{US}',
                '{"coverage_marketplaces":[{"marketplace_name":"Amazon.com"}]}','[{}]')""",
            (acquisition, self.seller),
        )
        self.connection.execute(
            "insert into private.source_preprocess_batches values(%s,%s,'1',%s,%s,now())",
            (batch, acquisition, len(charges), len(charges)),
        )
        for number, charge in enumerate(charges, start=1):
            native, version = uuid7(), uuid7()
            posted = charge.get("date", "2026-01-15")
            self.connection.execute(
                """insert into private.source_units(id,source,seller_namespace,amazon_scope,
                    unit_key)
                    values(%s,'FINANCES',%s,'NA',%s)""",
                (native, self.seller, str(native)),
            )
            self.connection.execute(
                "insert into private.source_unit_versions(id,unit_id,source,content_sha256,"
                "row_count)"
                " values (%s,%s,'FINANCES',decode(repeat('aa',32),'hex'),1)",
                (version, native),
            )
            self.connection.execute(
                """insert into private.finances_transactions(version_id,
                    posted_date,posted_at,marketplace_id,marketplace_name,customer_order_id,account_type,
                    transaction_type,transaction_status,is_activity,total_amount,currency,amount_count)
                    values(%s,%s,%s,'US','Amazon.com',%s,'Standard','Test','RELEASED',%s,%s,'USD',1)""",
                (
                    version,
                    posted,
                    charge.get("instant", posted),
                    charge.get("order"),
                    charge.get("is_activity", True),
                    charge["amount"],
                ),
            )
            self.connection.execute(
                """insert into private.finances_amounts(version_id,amount_number,selbox_group,
                    amount_type,
                    route,amount_part,sku,asin,fnsku,reference_id,covered_month,ledger_first_month,ledger_last_month,
                    fee_base,amount,breakdown_path,item_index,breakdown_indexes)
                    values(%s,1,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}',0,'{}')""",
                (
                    version,
                    "ACCOUNT_FEE" if charge["route"] == "SELBOX" else None,
                    charge.get("type", "EXPENSE"),
                    charge["route"],
                    charge.get("part", "BASE"),
                    charge.get("sku"),
                    charge.get("asin"),
                    charge.get("fnsku"),
                    charge.get("key"),
                    charge.get("month"),
                    charge.get("start"),
                    charge.get("end"),
                    charge.get("fee_base"),
                    charge["amount"],
                ),
            )
            self.connection.execute(
                "insert into private.source_batch_units values(%s,%s,%s,1,%s)",
                (batch, native, version, number),
            )
            self.connection.execute(
                "update private.source_units set current_version_id=%s,current_batch_id=%s "
                "where id=%s",
                (version, batch, native),
            )
        self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all deferred")
