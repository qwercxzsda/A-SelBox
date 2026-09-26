"""Isolated integration of archived bytes, offline parsing, and live SQL fees."""

import unittest
from datetime import UTC, date, datetime
from uuid import uuid7

import psycopg

from services.db.supabase.tests.integration_support import (
    DatabaseTestCase,
    TransactionDatabase,
)
from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from services.sync.src.amazon.reports.discovery import SETTLEMENT_REPORT_TYPE
from services.sync.src.amazon.reports.summaries import parse_done_report_summary
from services.sync.src.amazon.settlement_models import SettlementReportReference
from services.sync.src.amazon.settlement_tabular import SETTLEMENT_V2_COLUMNS
from services.sync.src.archives.models import (
    ArchivedDataKioskPage,
    DataKioskAcquisition,
    SettlementAcquisition,
)
from services.sync.src.archives.storage import archive_document
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import (
    load_settlement_acquisition,
    persist_data_kiosk_acquisition,
    persist_settlement_acquisition,
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
from services.sync.src.numeric import Numeric
from services.sync.src.preprocess_version import PREPROCESS_VERSION
from services.sync.src.settlement_preprocess.workflow import preprocess_settlement_report
from services.sync.src.source_serialization import source_json
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.economics import (
    complete_economics_document,
    economics_aggregated_detail,
)


def settlement_document(*, valid: bool = True) -> bytes:
    """A sale, later full refund, and recognized disposal expense share one report."""
    header = {
        "settlement-id": "integration-settlement",
        "settlement-start-date": "2026-08-01T00:00:00Z",
        "settlement-end-date": "2026-08-02T23:59:59Z",
        "deposit-date": "2026-08-03T00:00:00Z",
        "total-amount": "-10",
        "currency": "USD",
    }
    rows: list[dict[str, str]] = [header]
    for transaction, amount, day in (("Order", "100", "01"), ("Refund", "-100", "02")):
        rows.append(
            {
                "settlement-id": "integration-settlement",
                "transaction-type": transaction,
                "order-id": "integration-order",
                "marketplace-name": "Amazon.com",
                "amount-type": "ItemPrice",
                "amount-description": "Principal",
                "amount": amount,
                "posted-date": f"2026-08-{day}",
                "posted-date-time": f"2026-08-{day}T12:00:00Z",
                "sku": "SKU-1" if valid else "",
                "quantity-purchased": "1",
            }
        )
    rows.append(
        {
            "settlement-id": "integration-settlement",
            "transaction-type": "FBAFees",
            "amount-type": "FBA Removal Order: Disposal Fee",
            "amount-description": "Base fee",
            "amount": "-10",
            "posted-date": "2026-08-02",
            "posted-date-time": "2026-08-02T12:00:00Z",
            "sku": "",
        }
    )
    return (
        "\r\n".join(
            [
                "\t".join(SETTLEMENT_V2_COLUMNS),
                *(
                    "\t".join(row.get(column, "") for column in SETTLEMENT_V2_COLUMNS)
                    for row in rows
                ),
            ]
        )
        + "\r\n"
    ).encode()


class TestArchiveToLive(DatabaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.database = TransactionDatabase(self.connection)
        self.storage = MemoryArchiveStorage()
        self.seller = f"archive-integration-{uuid7()}"

    def test_report_aliases_without_marketplace_hints_keep_one_financial_settlement(self) -> None:
        document = archive_document(self.storage, settlement_document(), source_compression=None)
        aliases: tuple[tuple[str, dict[str, object]], ...] = (
            ("alias-a", {}),
            ("alias-b", {"marketplaceIds": []}),
        )
        for report_id, hints in aliases:
            metadata: dict[str, object] = {
                "reportId": report_id,
                "reportDocumentId": "shared-document",
                "reportType": SETTLEMENT_REPORT_TYPE,
                "processingStatus": "DONE",
                "createdTime": "2026-08-03T00:00:00Z",
                **hints,
            }
            summary = parse_done_report_summary(
                metadata, expected_report_types=(SETTLEMENT_REPORT_TYPE,)
            )
            acquisition = SettlementAcquisition(
                id=uuid7(),
                seller_namespace=self.seller,
                amazon_scope="NA",
                reference=SettlementReportReference(
                    report_id=summary.report_id,
                    report_document_id=summary.report_document_id,
                    report_created_at=summary.created_at,
                    marketplace_ids=summary.marketplace_ids,
                    api_metadata=metadata,
                ),
                downloaded_at=datetime.now(UTC),
                document=document,
                api_metadata=metadata,
            )
            saved = persist_settlement_acquisition(self.database, acquisition)
            loaded = load_settlement_acquisition(self.database, saved)
            self.assertEqual(loaded.reference.marketplace_ids, ())
            self.assertEqual(source_json(loaded.api_metadata), metadata)
            preprocess_settlement_report(self.database, self.storage, saved)
        self.assertEqual(
            self.connection.execute("select count(*) from private.settlements").fetchone(),
            (1,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from public.live_company_components where source='SETTLEMENT'"
            ).fetchone(),
            (2,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*),sum(amount) from public.settlement_preprocess_entries "
                "where category='DATA_KIOSK' and version_id in "
                "(select current_version_id from private.settlements)"
            ).fetchone(),
            (1, Numeric(-10)),
        )
        self.assertEqual(
            self.connection.execute(
                "select family,sku from public.settlement_preprocess_entries "
                "where category='DATA_KIOSK' and version_id in "
                "(select current_version_id from private.settlements)"
            ).fetchone(),
            ("C3_DISPOSAL", None),
        )
        self.assertEqual(len(self.storage.objects), 1)

    def save_settlement(self, *, valid: bool = True) -> str:
        identifier = uuid7()
        acquisition = SettlementAcquisition(
            id=identifier,
            seller_namespace=self.seller,
            amazon_scope="NA",
            reference=SettlementReportReference(
                report_id=f"report-{identifier}",
                report_document_id=f"document-{identifier}",
                report_created_at=datetime(2026, 8, 3, tzinfo=UTC),
                marketplace_ids=("ATVPDKIKX0DER", "unresolved-hint"),
            ),
            downloaded_at=datetime.now(UTC),
            document=archive_document(
                self.storage, settlement_document(valid=valid), source_compression=None
            ),
        )
        return persist_settlement_acquisition(self.database, acquisition)

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
            seller_namespace=self.seller,
            sku="SKU-1",
            company_id=company,
            expected_current_version_id=None,
            periods=[],
            change_reason="Assign cost ownership",
        )
        totals = load_company_financial_totals(
            self.database,
            seller_namespace=self.seller,
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 2),
            preprocess_version=PREPROCESS_VERSION,
            settlement_ids=(),
            marketplace_names=("Amazon.com",),
        )
        self.assertEqual(len(totals), 1)
        self.assertEqual(totals[0].source_amount, Numeric("-15.5"))
        self.assertEqual(totals[0].fee_amount, Numeric(0))
        self.assertEqual(totals[0].company_amount, Numeric("-15.5"))

    def test_offline_sources_live_refunds_and_schedule_corrections(self) -> None:
        settlement_input, economics_input = self.save_settlement(), self.save_data_kiosk()
        preprocess_settlement_report(self.database, self.storage, settlement_input)
        preprocess_data_kiosk_acquisition(self.database, self.storage, economics_input)
        row = self.connection.execute(
            "select id from private.settlements where seller_namespace = %s", (self.seller,)
        ).fetchone()
        if row is None:
            self.fail("Canonical settlement was not published.")
        settlement_id = str(row[0])
        with self.assertRaises(psycopg.Error), self.connection.transaction():
            self.read_totals(settlement_id)
        company = create_company(self.database, "Archive integration company")
        version = publish_sku_terms(
            self.database,
            seller_namespace=self.seller,
            sku="SKU-1",
            company_id=company,
            expected_current_version_id=None,
            change_reason="Initial terms",
            periods=[
                FeePeriod("Amazon.com", date(2026, 8, 1), date(2026, 8, 2), Numeric(5)),
                FeePeriod("Amazon.com", date(2026, 8, 2), None, Numeric(7)),
            ],
        )
        totals = self.read_totals(settlement_id)
        self.assertEqual(len(totals), 1)
        self.assertEqual(totals[0].source_amount, Numeric(-12))
        self.assertEqual(totals[0].fee_amount, Numeric(2))
        self.assertEqual(totals[0].company_amount, Numeric(-10))
        publish_sku_terms(
            self.database,
            seller_namespace=self.seller,
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
            self.read_totals(settlement_id)[0].company_amount,
            Numeric(-11),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.settlement_preprocess_versions "
                "where acquisition_id = %s",
                (settlement_input,),
            ).fetchone(),
            (1,),
        )

    def test_failed_preprocessing_retains_the_successful_acquisition(self) -> None:
        acquisition_id = self.save_settlement(valid=False)
        with (
            self.assertLogs("services.sync.src.settlement_preprocess.workflow", level="ERROR"),
            self.assertRaises(ValueError),
        ):
            preprocess_settlement_report(self.database, self.storage, acquisition_id)
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.settlement_acquisitions where id = %s",
                (acquisition_id,),
            ).fetchone(),
            (1,),
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.settlement_preprocess_versions "
                "where acquisition_id = %s",
                (acquisition_id,),
            ).fetchone(),
            (0,),
        )
        self.assertEqual(len(self.storage.objects), 1)

    def read_totals(self, settlement_id: str) -> tuple[CompanyFinancialTotal, ...]:
        return load_company_financial_totals(
            self.database,
            seller_namespace=self.seller,
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 2),
            preprocess_version=PREPROCESS_VERSION,
            settlement_ids=[settlement_id],
            marketplace_names=["Amazon.com"],
        )


if __name__ == "__main__":
    unittest.main()
