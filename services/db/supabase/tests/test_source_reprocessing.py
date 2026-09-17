"""Isolated verification of Python source publication and current day semantics."""

import unittest
from datetime import UTC, date, datetime
from uuid import uuid7

from services.db.supabase.tests.integration_support import (
    DatabaseTestCase,
    TransactionDatabase,
)
from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from services.sync.src.archives.models import ArchivedDataKioskPage, DataKioskAcquisition
from services.sync.src.archives.storage import archive_document
from services.sync.src.data_kiosk_economics.errors import UnresolvedDataKioskComponentError
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import persist_data_kiosk_acquisition
from services.sync.src.database.company_terms import create_company, publish_sku_terms
from services.sync.src.database.financial_reads import (
    CompanyFinancialTotal,
    load_company_financial_totals,
)
from services.sync.src.numeric import Numeric
from services.sync.src.preprocess_version import PREPROCESS_VERSION
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.economics import (
    complete_economics_document,
    economics_aggregated_detail,
)


def cost_document(
    amount: str = "5",
    *,
    sku: str = "SKU-1",
    day: str = "2026-08-01",
    label: str = "DisposalFee",
    ads: str = "[]",
) -> bytes:
    fees = (
        f'[{{"feeTypeName":"{label}","charges":[{{"identifier":"charge-one",'
        '"startDate":null,"endDate":null,"properties":[],"components":[],'
        f'"aggregatedDetail":{economics_aggregated_detail(amount)}' + "}]}]"
    )
    return complete_economics_document(
        msku=sku,
        fees=fees,
        ads=ads,
        start_date=day,
        end_date=day,
    )


class TestSourceReprocessing(DatabaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.database = TransactionDatabase(self.connection)
        self.storage = MemoryArchiveStorage()
        self.seller = f"day-integration-{uuid7()}"

    def save_observation(
        self,
        document: bytes | None,
        *,
        created_at: datetime,
        start_date: date = date(2026, 8, 1),
        end_date: date = date(2026, 8, 1),
    ) -> str:
        identifier = uuid7()
        query_id, document_id = f"query-{identifier}", f"document-{identifier}"
        query = build_daily_msku_economics_query(start_date, end_date, "ATVPDKIKX0DER")
        metadata: dict[str, object] = {
            "queryId": query_id,
            "createdTime": created_at.isoformat(),
            "processingStatus": "DONE",
            "query": query,
        }
        if document is not None:
            metadata["dataDocumentId"] = document_id
        page = ArchivedDataKioskPage(
            page_number=1,
            query_id=query_id,
            query_created_at=created_at,
            document_kind=DataKioskDocumentKind.NO_DATA
            if document is None
            else DataKioskDocumentKind.DATA,
            document_id=None if document is None else document_id,
            document=None
            if document is None
            else archive_document(self.storage, document, source_compression=None),
            is_terminal=True,
            api_metadata=metadata,
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
            query_start_date=start_date,
            query_end_date=end_date,
            downloaded_at=datetime.now(UTC),
            pages=(page,),
            api_metadata=metadata,
        )
        return persist_data_kiosk_acquisition(self.database, acquisition)

    def current_day(self, activity_date: date) -> tuple[object, ...]:
        row = self.connection.execute(
            "select d.current_version_id,v.row_count,b.acquisition_id "
            "from private.data_kiosk_days d "
            "join private.data_kiosk_preprocess_versions v on v.id=d.current_version_id "
            "join private.data_kiosk_preprocess_batches b on b.id=v.batch_id "
            "where d.seller_namespace=%s and d.activity_date=%s",
            (self.seller, activity_date),
        ).fetchone()
        if row is None:
            self.fail("Complete day selection is missing.")
        return row

    def assign(self, *skus: str) -> None:
        company = create_company(self.database, "Day integration company")
        for sku in skus:
            publish_sku_terms(
                self.database,
                seller_namespace=self.seller,
                sku=sku,
                company_id=company,
                expected_current_version_id=None,
                periods=[],
                change_reason="Assign cost ownership",
            )

    def totals(self, *, end_date: date = date(2026, 8, 1)) -> tuple[CompanyFinancialTotal, ...]:
        return load_company_financial_totals(
            self.database,
            seller_namespace=self.seller,
            start_date=date(2026, 8, 1),
            end_date=end_date,
            preprocess_version=PREPROCESS_VERSION,
            settlement_ids=[],
            marketplace_names=["Amazon.com"],
        )

    def test_complete_empty_day_removes_disappeared_skus_and_leaves_unqueried_day_selected(
        self,
    ) -> None:
        initial = self.save_observation(
            cost_document("5") + cost_document("7", sku="SKU-2", day="2026-08-02"),
            created_at=datetime(2026, 8, 4, 12, tzinfo=UTC),
            end_date=date(2026, 8, 2),
        )
        preprocess_data_kiosk_acquisition(self.database, self.storage, initial)
        original_day_one = self.current_day(date(2026, 8, 1))
        original_day_two = self.current_day(date(2026, 8, 2))
        self.assign("SKU-1", "SKU-2")
        self.assertEqual(self.totals(end_date=date(2026, 8, 2))[0].source_amount, Numeric(-12))
        empty = self.save_observation(None, created_at=datetime(2026, 8, 5, 12, tzinfo=UTC))
        preprocess_data_kiosk_acquisition(self.database, self.storage, empty)
        replaced = self.current_day(date(2026, 8, 1))
        self.assertNotEqual(replaced[0], original_day_one[0])
        self.assertEqual(replaced[1], 0)
        self.assertEqual(str(replaced[2]), empty)
        self.assertEqual(self.current_day(date(2026, 8, 2)), original_day_two)
        self.assertEqual(self.totals(), ())
        self.assertEqual(self.totals(end_date=date(2026, 8, 2))[0].source_amount, Numeric(-7))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.data_kiosk_others_entries "
                "where seller_namespace=%s and sku='SKU-1'",
                (self.seller,),
            ).fetchone(),
            (0,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_acquisitions where seller_namespace=%s",
                (self.seller,),
            ).fetchone(),
            (2,),
        )
        self.assertEqual(len(self.storage.objects), 1)
        self.connection.execute("set constraints all immediate")

    def test_reprocessing_older_archive_cannot_advance_amazon_observation_freshness(self) -> None:
        old = self.save_observation(
            cost_document("5"), created_at=datetime(2026, 8, 4, 12, tzinfo=UTC)
        )
        new = self.save_observation(
            cost_document("9"), created_at=datetime(2026, 8, 5, 12, tzinfo=UTC)
        )
        preprocess_data_kiosk_acquisition(self.database, self.storage, new)
        newest_selection = self.current_day(date(2026, 8, 1))
        preprocess_data_kiosk_acquisition(self.database, self.storage, old)
        preprocess_data_kiosk_acquisition(self.database, self.storage, old)
        self.assertEqual(self.current_day(date(2026, 8, 1)), newest_selection)
        self.assertEqual(str(newest_selection[2]), new)
        latest_result = self.connection.execute(
            "select v.id,b.acquisition_id from private.data_kiosk_preprocess_versions v "
            "join private.data_kiosk_preprocess_batches b on b.id=v.batch_id "
            "join private.data_kiosk_acquisitions a on a.id=b.acquisition_id "
            "where a.seller_namespace=%s order by v.id desc limit 1",
            (self.seller,),
        ).fetchone()
        if latest_result is None:
            self.fail("Retained historical result is missing.")
        self.assertEqual(str(latest_result[1]), old)
        self.assertNotEqual(latest_result[0], newest_selection[0])
        self.assign("SKU-1")
        self.assertEqual(self.totals()[0].source_amount, Numeric(-9))
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_preprocess_batches b "
                "join private.data_kiosk_acquisitions a on a.id=b.acquisition_id "
                "where a.seller_namespace=%s",
                (self.seller,),
            ).fetchone(),
            (3,),
        )
        self.assertEqual(len(self.storage.objects), 2)
        self.connection.execute("set constraints all immediate")

    def test_unknown_or_incomplete_components_abort_before_publication_and_retain_archives(
        self,
    ) -> None:
        valid = self.save_observation(
            cost_document("5"), created_at=datetime(2026, 8, 4, 12, tzinfo=UTC)
        )
        preprocess_data_kiosk_acquisition(self.database, self.storage, valid)
        original_day = self.current_day(date(2026, 8, 1))
        self.assign("SKU-1")
        original_totals = self.totals()
        invalid_documents = (
            (cost_document(label="UnreviewedNewFee"), "UNKNOWN_FEE"),
            (
                cost_document(ads='[{"adTypeName":"Sponsored Products charge","charge":null}]'),
                "MISSING_AD_CHARGE",
            ),
        )
        for document, reason in invalid_documents:
            with self.subTest(reason=reason):
                acquisition = self.save_observation(
                    document, created_at=datetime(2026, 8, 5, 12, tzinfo=UTC)
                )
                archived_objects = self.storage.objects.copy()
                with (
                    self.assertLogs("services.sync.src.data_kiosk_economics.workflow", "ERROR"),
                    self.assertRaises(UnresolvedDataKioskComponentError) as raised,
                ):
                    preprocess_data_kiosk_acquisition(self.database, self.storage, acquisition)
                self.assertEqual(raised.exception.reason, reason)
                self.assertEqual(self.current_day(date(2026, 8, 1)), original_day)
                self.assertEqual(self.totals(), original_totals)
                self.assertEqual(
                    self.connection.execute(
                        "select count(*) from private.data_kiosk_preprocess_batches "
                        "where acquisition_id=%s",
                        (acquisition,),
                    ).fetchone(),
                    (0,),
                )
                self.assertEqual(
                    self.connection.execute(
                        "select count(*) from private.data_kiosk_acquisitions where id=%s",
                        (acquisition,),
                    ).fetchone(),
                    (1,),
                )
                self.assertEqual(self.storage.objects, archived_objects)
        self.assertEqual(len(self.storage.objects), 3)
        self.connection.execute("set constraints all immediate")


if __name__ == "__main__":
    unittest.main()
