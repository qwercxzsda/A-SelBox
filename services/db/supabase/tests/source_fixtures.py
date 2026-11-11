"""Shared successful-source fixture builders for fresh-baseline database tests."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime
from typing import Literal, LiteralString
from uuid import uuid7

from psycopg.types.json import Jsonb

from services.db.supabase.tests.integration_support import DatabaseTestCase, TransactionDatabase
from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_finances import acquisition, finances
from services.db.supabase.tests.source_kiosk import publish_kiosk_fixture
from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.marketplace_names import MARKETPLACE_NAME_BY_ID
from services.sync.src.amazon.marketplaces import CREDENTIAL_SCOPES
from services.sync.src.archives.models import ArchivedDataKioskPage, DataKioskAcquisition
from services.sync.src.archives.serialization import document_from_payload
from services.sync.src.data_kiosk_economics.timestamps import reporting_activity_at
from services.sync.src.database.acquisitions import persist_data_kiosk_acquisition
from services.sync.src.finances.acquisition_models import FinancesAcquisition
from services.sync.src.source_serialization import content_sha256


def new_id() -> str:
    return str(uuid7())


def kiosk_timestamp(day: str, marketplace: str = "Amazon.com") -> str:
    """Use preprocessing's normalized reporting instant in synthetic publications."""
    return reporting_activity_at(date.fromisoformat(day), marketplace).isoformat()


def kiosk_content_hash(activity_at: str, rows: Sequence[dict[str, object]]) -> str:
    """Deduplicate synthetic day contents independently of generated component IDs."""
    components = [{key: value for key, value in row.items() if key != "id"} for row in rows]
    components.sort(key=lambda row: str(row["component_key"]))
    return content_sha256({"activity_at": activity_at, "transactions": components})


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
    acquisition = acquisition
    finances = finances

    def publish_kiosk_days(self, payload: dict[str, object]) -> str:
        return publish_kiosk_fixture(TransactionDatabase(self.connection), payload)

    def setUp(self) -> None:
        super().setUp()
        self.seller = "seller-one"
        self.finances_acquisitions: dict[str, FinancesAcquisition] = {}
        self.last_finances_batch_ids: list[str] = []

    def finances_versions(self, *batches: str) -> list[str]:
        """Read the immutable transaction revisions from successful fixture captures."""
        return [
            str(row[0])
            for row in self.connection.execute(
                "select distinct version_id::text "
                "from private.finances_preprocess_batch_transactions "
                "where batch_id=any(%s::uuid[]) order by version_id::text",
                (list(batches),),
            ).fetchall()
        ]

    def current_activity_date(self) -> str:
        """Use today's UTC date without coupling source fixtures to payout eligibility."""
        return str(
            require_row(
                self.connection.execute(
                    "select (current_timestamp at time zone 'UTC')::date"
                ).fetchone()
            )[0]
        )

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
        role: Literal["administrator", "member"],
        company: str | None = None,
    ) -> str:
        user = self.auth_user()
        self.connection.execute(
            "update public.app_accounts set access_role=%s,company_id=%s where user_id=%s",
            (role, company, user),
        )
        return user

    def member(self, company: str) -> str:
        return self.account("member", company)

    def administrator(self) -> str:
        return self.account("administrator")

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

    def owner(self, sku: str = "SKU") -> tuple[str, str]:
        company, identity = new_id(), new_id()
        self.connection.execute(
            "insert into public.companies(id,name) values (%s,'Company')", (company,)
        )
        self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": identity,
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
                "select s.sku,v.company_id,s.current_terms_version_id "
                "from public.skus s join public.sku_terms_versions v "
                "on v.id=s.current_terms_version_id where s.id=%s",
                (owner,),
            ).fetchone()
        )
        return self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "sku_id": owner,
                "sku": row[0],
                "company_id": str(row[1]) if row[1] is not None else None,
                "expected_current_version_id": expected or str(row[2]),
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

    @staticmethod
    def transaction(
        amount: str,
        line: int = 3,
        *,
        sku: str = "SKU",
        activity_date: str = "2026-06-15",
        kind: str = "Shipment",
        category: str = "FINANCES",
        description: str = "Principal",
    ) -> dict[str, object]:
        component_type = f"{kind}/{description}"
        fee_base = None
        if kind in {"Shipment", "Refund"} and description == "Principal" and category == "FINANCES":
            component_type = "PRODUCT_REFUNDS" if kind == "Refund" else "PRODUCT_SALES"
            fee_base = amount
        return {
            "id": new_id(),
            "native_transaction_id": f"{activity_date}:{line}:{sku}:{kind}:{description}",
            "source_record_number": line,
            "category": category,
            "component_type": component_type,
            "sku": sku,
            "marketplace_name": "Amazon.com",
            "amount": amount,
            "currency": "USD",
            "quantity": 1 if fee_base is not None else None,
            "fee_base": fee_base,
            "posted_date": activity_date,
            "posted_at": activity_date + "T12:00:00Z",
            "transaction_type": kind,
            "breakdown_path": [description],
        }

    def kiosk_acquisition(
        self,
        observation: int,
        *,
        start: str = "2026-06-15",
        end: str | None = None,
        marketplace_id: str = "ATVPDKIKX0DER",
        amazon_scope: str = "NA",
        marketplace: str | None = None,
    ) -> str:
        if marketplace is not None:
            marketplace_id = next(
                identifier
                for identifier, name in MARKETPLACE_NAME_BY_ID.items()
                if name == marketplace
            )
            amazon_scope = next(
                name
                for name, scope in CREDENTIAL_SCOPES.items()
                if marketplace_id in scope.marketplace_ids
            )
        query_id, document_id = new_id(), new_id()
        created = f"2026-09-{observation:02d}T00:00:00Z"
        metadata = {
            "queryId": query_id,
            "createdTime": created,
            "processingStatus": "DONE",
            "dataDocumentId": document_id,
            "query": "economics complete DAY",
        }
        timestamp = datetime.fromisoformat(created)
        page = ArchivedDataKioskPage(
            page_number=1,
            query_id=query_id,
            query_created_at=timestamp,
            document_kind=DataKioskDocumentKind.DATA,
            is_terminal=True,
            document_id=document_id,
            document=document_from_payload(archive_document()),
            api_metadata=metadata,
        )
        acquisition = DataKioskAcquisition(
            id=uuid7(),
            seller_namespace=self.seller,
            amazon_scope=amazon_scope,
            root_query_id=query_id,
            root_query_created_at=timestamp,
            schema_version="analytics_economics_2024_03_15",
            query_definition="economics complete DAY",
            marketplace_id=marketplace_id,
            query_start_date=date.fromisoformat(start),
            query_end_date=date.fromisoformat(end or start),
            api_metadata=metadata,
            downloaded_at=timestamp,
            pages=(page,),
        )
        return persist_data_kiosk_acquisition(TransactionDatabase(self.connection), acquisition)

    def kiosk(
        self,
        observation: int,
        rows: list[dict[str, object]],
        *,
        expected: str | None = None,
        acquisition_id: str | None = None,
        version: str = "v0",
        activity_date: str = "2026-06-15",
        activity_at: str | None = None,
    ) -> tuple[str, str]:
        selected = self.connection.execute(
            "select current_batch_id from private.data_kiosk_days where seller_namespace=%s "
            "and marketplace_name='Amazon.com' and activity_date=%s and dataset_key='economics'",
            (self.seller, activity_date),
        ).fetchone()
        timestamp = activity_at if activity_at is not None else kiosk_timestamp(activity_date)
        batch_id = self.publish_kiosk_days(
            {
                "acquisition_id": acquisition_id
                or self.kiosk_acquisition(observation, start=activity_date),
                "preprocess_version": version,
                "dataset_key": "economics",
                "days": [
                    {
                        "marketplace_name": "Amazon.com",
                        "activity_date": activity_date,
                        "activity_at": timestamp,
                        "expected_current_version_id": expected,
                        "expected_current_batch_id": None
                        if selected is None or selected[0] is None
                        else str(selected[0]),
                        "content_sha256": kiosk_content_hash(timestamp, rows),
                        "transactions": rows,
                    }
                ],
            },
        )
        row = require_row(
            self.connection.execute(
                "select day_id,version_id from private.data_kiosk_preprocess_batch_days "
                "where batch_id=%s",
                (batch_id,),
            ).fetchone()
        )
        return str(row[0]), str(row[1])

    def kiosk_observation(self, version_id: str) -> str:
        """Select the current observation of a version, or its latest retained observation."""
        row = require_row(
            self.connection.execute(
                "select m.id from private.data_kiosk_preprocess_batch_days m "
                "join private.data_kiosk_days d on d.id=m.day_id "
                "join private.data_kiosk_preprocess_batches b on b.id=m.batch_id "
                "join private.data_kiosk_acquisitions a on a.id=b.acquisition_id "
                "where m.version_id=%s order by (m.batch_id=d.current_batch_id) desc,"
                "a.root_query_created_at desc,a.id desc,b.id desc limit 1",
                (version_id,),
            ).fetchone()
        )
        return str(row[0])

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
        }

    def totals(
        self,
        finances_batch_ids: list[str],
        marketplaces: list[str] | None = None,
        version: str = "v0",
    ) -> list[tuple[object, ...]]:
        return self.connection.execute(
            "select * from private.company_financial_totals("
            "%s,'2026-06-01','2026-08-31',%s,%s::uuid[],%s::text[])",
            (self.seller, version, finances_batch_ids, marketplaces or []),
        ).fetchall()
