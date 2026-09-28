"""Shared successful-source fixture builders for fresh-baseline database tests."""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal
from typing import Literal, LiteralString
from uuid import uuid7

from psycopg.types.json import Jsonb

from services.db.supabase.tests.integration_support import DatabaseTestCase
from services.db.supabase.tests.local_database import require_row


def new_id() -> str:
    return str(uuid7())


def archive_document(digest: str = "a") -> dict[str, object]:
    return {
        "bucket": "source-archives",
        "object_path": f"test/{digest}.xz",
        "document_sha256": digest * 64,
        "document_byte_length": 123,
        "archive_sha256": "b" * 64,
        "archive_byte_length": 100,
        "source_compression": None,
        "archive_codec": "xz",
        "archive_preset": "2e",
        "archive_check": "CRC64",
    }


class SourceModelFixture(DatabaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.seller = "seller-one"

    def recent_activity_date(self) -> str:
        """Use the mature cutoff date for recent fixture facts."""
        return self.mature_cutoff_date().isoformat()

    def call(self, function: str, payload: dict[str, object]) -> str:
        from psycopg import sql

        row = require_row(
            self.connection.execute(
                sql.SQL("select private.{}(%s::jsonb)").format(sql.Identifier(function)),
                (Jsonb(payload),),
            ).fetchone()
        )
        return str(row[0])

    def auth_user(self) -> str:
        """Create a login identity without granting application access."""
        user = new_id()
        self.connection.execute("insert into auth.users(id) values (%s)", (user,))
        return user

    def account(
        self,
        role: Literal["operator", "company_member"],
        company: str | None = None,
    ) -> str:
        user = self.auth_user()
        self.connection.execute(
            "insert into public.app_accounts(user_id,access_role,company_id) values (%s,%s,%s)",
            (user, role, company),
        )
        return user

    def member(self, company: str) -> str:
        return self.account("company_member", company)

    def operator(self) -> str:
        return self.account("operator")

    def as_user(
        self,
        user: str,
        query: LiteralString,
        parameters: Sequence[object] | None = None,
    ) -> list[tuple[object, ...]]:
        with self.connection.transaction():
            self.connection.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
            self.connection.execute("set local role authenticated")
            result = self.connection.execute(query, parameters).fetchall()
            self.connection.execute("reset role")
            return result

    def owner(self, sku: str = "SKU", *, seller: str | None = None) -> tuple[str, str]:
        company, identity = new_id(), new_id()
        self.connection.execute(
            "insert into public.companies(id,name) values (%s,'Company')", (company,)
        )
        self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "seller_sku_id": identity,
                "seller_namespace": seller or self.seller,
                "sku": sku,
                "company_id": company,
                "expected_current_version_id": None,
                "change_reason": "Test initial ownership",
                "periods": [],
            },
        )
        return company, identity

    def fee(
        self,
        owner: str,
        periods: Sequence[tuple[str, str | None, str]],
        expected: str | None = None,
    ) -> str:
        row = require_row(
            self.connection.execute(
                "select s.seller_namespace,s.sku,v.company_id,s.current_terms_version_id "
                "from public.seller_skus s join public.sku_terms_versions v "
                "on v.id=s.current_terms_version_id where s.id=%s",
                (owner,),
            ).fetchone()
        )
        return self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "seller_sku_id": owner,
                "seller_namespace": row[0],
                "sku": row[1],
                "company_id": str(row[2]) if row[2] is not None else None,
                "expected_current_version_id": expected or str(row[3]),
                "change_reason": "Test complete terms",
                "periods": [
                    {
                        "id": new_id(),
                        "marketplace_name": "Amazon.com",
                        "valid_from": start,
                        "valid_to": end,
                        "fee_rate_percent": rate,
                    }
                    for start, end, rate in periods
                ],
            },
        )

    def acquisition(self, *, document_id: str = "document", digest: str = "a") -> str:
        return self.call(
            "publish_settlement_acquisition",
            {
                "id": new_id(),
                "seller_namespace": self.seller,
                "amazon_scope": "NA",
                "report_id": new_id(),
                "report_document_id": document_id,
                "report_type": "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
                "report_created_at": "2026-09-01T00:00:00Z",
                "marketplace_ids": ["unmapped-hint-is-allowed"],
                "api_metadata": {},
                "downloaded_at": "2026-09-01T00:00:00Z",
                "document_sha256": digest * 64,
                "document": archive_document(digest),
            },
        )

    def settlement(
        self,
        rows: list[dict[str, object]],
        *,
        acquisition_id: str | None = None,
        expected: str | None = None,
        version: str = "v0",
        identity: str = "settlement",
    ) -> tuple[str, str]:
        total = sum((Decimal(str(row["amount"])) for row in rows), Decimal(0))
        version_id = self.call(
            "publish_settlement_preprocess",
            {
                "id": new_id(),
                "acquisition_id": acquisition_id or self.acquisition(),
                "expected_current_version_id": expected,
                "preprocess_version": version,
                "settlement_id": identity,
                "diagnostics": [],
                "metadata": {
                    "settlement_start_at": "2026-06-01T00:00:00Z",
                    "settlement_end_at": "2026-08-31T23:59:59Z",
                    "deposit_at": None,
                    "settlement_start_date": "2026-06-01",
                    "settlement_end_date": "2026-08-31",
                    "total_amount": str(total),
                    "currency": "USD",
                    "source_line_number": 2,
                },
                "transactions": rows,
            },
        )
        row = require_row(
            self.connection.execute(
                "select id from private.settlements where seller_namespace=%s "
                "and amazon_scope='NA' and settlement_id=%s",
                (self.seller, identity),
            ).fetchone()
        )
        return str(row[0]), version_id

    @staticmethod
    def transaction(
        amount: str,
        line: int = 3,
        *,
        sku: str = "SKU",
        activity_date: str = "2026-06-15",
        kind: str = "Order",
        category: str = "SETTLEMENT",
        description: str = "Principal",
    ) -> dict[str, object]:
        component_type = f"{kind}/ItemPrice/{description}"
        if kind in {"Order", "Refund"} and description == "Principal":
            component_type = "PRODUCT_REFUNDS" if kind == "Refund" else "PRODUCT_SALES"
        return {
            "id": new_id(),
            "source_line_number": line,
            "category": category,
            "family": "F1",
            "component_type": component_type,
            "sku": sku,
            "marketplace_name": "Amazon.com",
            "amount": amount,
            "currency": "USD",
            "quantity": 1,
            "posted_date": activity_date,
            "posted_at": activity_date + "T12:00:00Z",
            "transaction_type": kind,
            "amount_type": "ItemPrice",
            "amount_description": description,
            "source_fields": {},
        }

    def kiosk_acquisition(
        self, observation: int, *, start: str = "2026-06-15", end: str | None = None
    ) -> str:
        query_id, document_id = new_id(), new_id()
        created = f"2026-09-{observation:02d}T00:00:00Z"
        metadata = {
            "queryId": query_id,
            "createdTime": created,
            "processingStatus": "DONE",
            "dataDocumentId": document_id,
            "query": "economics complete DAY",
        }
        return self.call(
            "publish_data_kiosk_acquisition",
            {
                "id": new_id(),
                "seller_namespace": self.seller,
                "amazon_scope": "NA",
                "root_query_id": query_id,
                "root_query_created_at": created,
                "schema_version": "analytics_economics_2024_03_15",
                "query_definition": "economics complete DAY",
                "marketplace_ids": ["ATVPDKIKX0DER"],
                "query_start_date": start,
                "query_end_date": end or start,
                "api_metadata": metadata,
                "downloaded_at": created,
                "documents": [
                    {
                        "page_number": 1,
                        "query_id": query_id,
                        "query_created_at": created,
                        "document_kind": "DATA",
                        "is_terminal": True,
                        "document_id": document_id,
                        "document": archive_document(),
                        "api_metadata": metadata,
                    }
                ],
            },
        )

    def kiosk(
        self,
        observation: int,
        rows: list[dict[str, object]],
        *,
        expected: str | None = None,
        acquisition_id: str | None = None,
        version: str = "v0",
        digest: str = "a",
        activity_date: str = "2026-06-15",
    ) -> tuple[str, str]:
        version_id = new_id()
        self.call(
            "publish_data_kiosk_preprocess",
            {
                "id": new_id(),
                "acquisition_id": acquisition_id
                or self.kiosk_acquisition(observation, start=activity_date),
                "preprocess_version": version,
                "dataset_key": "economics",
                "days": [
                    {
                        "id": version_id,
                        "marketplace_name": "Amazon.com",
                        "activity_date": activity_date,
                        "expected_current_version_id": expected,
                        "content_sha256": digest * 64,
                        "transactions": rows,
                    }
                ],
            },
        )
        row = require_row(
            self.connection.execute(
                "select id from private.data_kiosk_days where seller_namespace=%s "
                "and marketplace_name='Amazon.com' and activity_date=%s "
                "and dataset_key='economics'",
                (self.seller, activity_date),
            ).fetchone()
        )
        return str(row[0]), version_id

    @staticmethod
    def component(
        amount: str | None = "-10", *, sku: str = "SKU", category: str = "DATA_KIOSK"
    ) -> dict[str, object]:
        return {
            "id": new_id(),
            "component_key": new_id(),
            "sku": sku,
            "component_type": "FbaStorageFee",
            "amount": amount,
            "currency": "USD",
            "quantity": None,
            "fee_base": None,
            "category": category,
            "native_dimensions": {},
            "source_document_id": "document",
            "source_line_number": 1,
        }

    def totals(
        self,
        settlements: list[str],
        marketplaces: list[str] | None = None,
        version: str = "v0",
    ) -> list[tuple[object, ...]]:
        return self.connection.execute(
            "select * from private.company_financial_totals("
            "%s,'2026-06-01','2026-08-31',%s,%s::uuid[],%s::text[])",
            (self.seller, version, settlements, marketplaces or []),
        ).fetchall()
