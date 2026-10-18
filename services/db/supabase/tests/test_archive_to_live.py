"""Isolated integration of archived bytes, offline parsing, and live SQL fees."""

import unittest
from datetime import UTC, date, datetime
from uuid import uuid7

import psycopg

from services.db.supabase.tests.finances_fixtures import finances_capture, native_transaction
from services.db.supabase.tests.integration_support import (
    DatabaseTestCase,
    TransactionDatabase,
)
from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from services.sync.src.archives.models import (
    ArchivedDataKioskPage,
    DataKioskAcquisition,
)
from services.sync.src.archives.storage import archive_document
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    load_finances_acquisition,
    persist_data_kiosk_acquisition,
    persist_finances_acquisition,
)
from services.sync.src.database.company_terms import (
    FeePeriod,
    create_company,
    publish_sku_terms,
)
from services.sync.src.database.financial_reads import (
    CompanyFinancialTotal,
    load_company_financial_totals,
)
from services.sync.src.finances.workflow import preprocess_finances_acquisition
from services.sync.src.numeric import Numeric
from services.sync.src.preprocess_version import PREPROCESS_VERSION
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.economics import (
    complete_economics_document,
    economics_aggregated_detail,
)


class TestArchiveToLive(DatabaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.set_mature_cutoff_date(date(2026, 7, 1))
        self.database = TransactionDatabase(self.connection)
        self.storage = MemoryArchiveStorage()
        self.seller = f"archive-integration-{uuid7()}"

    def test_repeated_captures_replace_days_without_adding_transactions(self) -> None:
        rows = [
            native_transaction(100),
            native_transaction(-100, kind="Refund", day="2026-08-02"),
            native_transaction(-10, kind="ServiceFee", sku=None, day="2026-08-02"),
        ]
        for _ in range(2):
            capture = finances_capture(self.storage, rows, seller=self.seller)
            identifier = persist_finances_acquisition(self.database, capture)
            self.assertEqual(load_finances_acquisition(self.database, identifier), capture)
            preprocess_finances_acquisition(self.database, self.storage, identifier)
        self.assertEqual(
            self.connection.execute("select count(*) from private.finances_days").fetchone(), (2,)
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*),sum(amount) from public.finances_preprocess_entries "
                "where category='DATA_KIOSK' and version_id in "
                "(select current_version_id from private.finances_days)"
            ).fetchone(),
            (1, Numeric(-10)),
        )
        self.assertEqual(
            self.connection.execute(
                "select component_type,sku from public.finances_preprocess_entries "
                "where category='DATA_KIOSK' and version_id in "
                "(select current_version_id from private.finances_days)"
            ).fetchone(),
            ("DISPOSAL_FEES", None),
        )
        self.assertEqual(len(self.storage.objects), 2)

    def save_finances(self, *, valid: bool = True) -> str:
        rows = [
            native_transaction(100, sku="SKU-1" if valid else None),
            native_transaction(-100, kind="Refund", day="2026-08-02"),
            native_transaction(-10, kind="ServiceFee", sku=None, day="2026-08-02"),
        ]
        capture = finances_capture(self.storage, rows, seller=self.seller)
        return persist_finances_acquisition(self.database, capture)

    def save_data_kiosk(self, *, ads: str = "[]") -> str:
        identifier = uuid7()
        query_id = f"query-{identifier}"
        document_id = f"data-{identifier}"
        created_at = datetime(2026, 8, 3, 12, tzinfo=UTC)
        query = build_daily_msku_economics_query(
            date(2026, 8, 1), date(2026, 8, 2), "ATVPDKIKX0DER"
        )
        metadata: dict[str, object] = {
            "queryId": query_id,
            "createdTime": created_at.isoformat(),
            "processingStatus": "DONE",
            "query": query,
            "dataDocumentId": document_id,
        }
        details = economics_aggregated_detail("12")
        fees = (
            '[{"feeTypeName":"DisposalFee","charges":[{"identifier":"disposal-1",'
            '"startDate":null,"endDate":null,"properties":[],"components":[],'
            f'"aggregatedDetail":{details}' + "}]}]"
        )
        document = archive_document(
            self.storage, complete_economics_document(fees=fees, ads=ads), source_compression=None
        )
        acquisition = DataKioskAcquisition(
            id=identifier,
            seller_namespace=self.seller,
            amazon_scope="NA",
            root_query_id=query_id,
            root_query_created_at=created_at,
            query_definition=query,
            schema_version=ECONOMICS_SCHEMA_NAME,
            marketplace_id="ATVPDKIKX0DER",
            query_start_date=date(2026, 8, 1),
            query_end_date=date(2026, 8, 2),
            downloaded_at=datetime.now(UTC),
            api_metadata=metadata,
            pages=(
                ArchivedDataKioskPage(
                    page_number=1,
                    query_id=query_id,
                    query_created_at=created_at,
                    document_kind=DataKioskDocumentKind.DATA,
                    is_terminal=True,
                    document_id=document_id,
                    document=document,
                    api_metadata=metadata,
                ),
            ),
        )
        return persist_data_kiosk_acquisition(self.database, acquisition)

    def test_observed_advertising_charge_enters_company_cost_once_without_commission(self) -> None:
        ads = (
            '[{"adTypeName":"SponsoredProductFee","charge":'
            + economics_aggregated_detail("3.5")
            + "}]"
        )
        acquisition = self.save_data_kiosk(ads=ads)
        preprocess_data_kiosk_acquisition(self.database, self.storage, acquisition)
        company = create_company(self.database, "Advertising company")
        publish_sku_terms(
            self.database,
            sku="SKU-1",
            company_id=company,
            expected_current_version_id=None,
            periods=[FeePeriod("Amazon.com", date(2026, 1, 1), None, Numeric(0))],
            change_reason="Assign cost ownership",
        )
        totals = load_company_financial_totals(
            self.database,
            seller_namespace=self.seller,
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 2),
            preprocess_version=PREPROCESS_VERSION,
            finances_day_ids=(),
            marketplace_names=("Amazon.com",),
        )
        self.assertEqual(len(totals), 1)
        self.assertEqual(totals[0].source_amount, Numeric("-15.5"))
        self.assertEqual(totals[0].fee_amount, Numeric(0))
        self.assertEqual(totals[0].company_amount, Numeric("-15.5"))

    def test_recent_sources_ignore_finances_refunds_and_use_kiosk_fee_base(self) -> None:
        finances_input, economics_input = self.save_finances(), self.save_data_kiosk()
        preprocess_finances_acquisition(self.database, self.storage, finances_input)
        preprocess_data_kiosk_acquisition(self.database, self.storage, economics_input)
        row = self.connection.execute(
            "select id from private.finances_days where seller_namespace = %s", (self.seller,)
        ).fetchone()
        if row is None:
            self.fail("Canonical finances was not published.")
        finances_id = str(row[0])
        with self.assertRaises(psycopg.Error), self.connection.transaction():
            self.read_totals(finances_id)
        company = create_company(self.database, "Archive integration company")
        version = publish_sku_terms(
            self.database,
            sku="SKU-1",
            company_id=company,
            expected_current_version_id=None,
            change_reason="Initial terms",
            periods=[
                FeePeriod("Amazon.com", date(2026, 8, 1), date(2026, 8, 2), Numeric(5)),
                FeePeriod("Amazon.com", date(2026, 8, 2), None, Numeric(7)),
            ],
        )
        totals = self.read_totals(finances_id)
        self.assertEqual(len(totals), 1)
        self.assertEqual(totals[0].source_amount, Numeric(-12))
        self.assertEqual(totals[0].fee_amount, Numeric(0))
        self.assertEqual(totals[0].company_amount, Numeric(-12))
        publish_sku_terms(
            self.database,
            sku="SKU-1",
            company_id=company,
            expected_current_version_id=version,
            change_reason="Retroactive correction",
            periods=[
                FeePeriod("Amazon.com", date(2026, 8, 1), date(2026, 8, 2), Numeric(6)),
                FeePeriod("Amazon.com", date(2026, 8, 2), None, Numeric(7)),
            ],
        )
        self.assertEqual(
            self.read_totals(finances_id)[0].company_amount,
            Numeric(-12),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_preprocess_versions v "
                "join private.finances_preprocess_batches b on b.id=v.batch_id "
                "where b.acquisition_id = %s",
                (finances_input,),
            ).fetchone(),
            (2,),
        )

    def test_failed_preprocessing_retains_the_successful_acquisition(self) -> None:
        acquisition_id = self.save_finances(valid=False)
        with self.assertRaises(ValueError):
            preprocess_finances_acquisition(self.database, self.storage, acquisition_id)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_acquisitions where id = %s",
                (acquisition_id,),
            ).fetchone(),
            (1,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_preprocess_versions v "
                "join private.finances_preprocess_batches b on b.id=v.batch_id "
                "where b.acquisition_id = %s",
                (acquisition_id,),
            ).fetchone(),
            (0,),
        )
        self.assertEqual(len(self.storage.objects), 2)

    def read_totals(self, finances_id: str) -> tuple[CompanyFinancialTotal, ...]:
        return load_company_financial_totals(
            self.database,
            seller_namespace=self.seller,
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 2),
            preprocess_version=PREPROCESS_VERSION,
            finances_day_ids=[finances_id],
            marketplace_names=["Amazon.com"],
        )


if __name__ == "__main__":
    unittest.main()
