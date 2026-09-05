"""Opt-in repository integration checks with synthetic, always-rolled-back rows."""

import os
import unittest
from contextlib import AbstractContextManager, nullcontext
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from itertools import count
from pathlib import Path
from tempfile import TemporaryDirectory
from types import TracebackType
from typing import Literal, Self, cast
from unittest.mock import patch
from uuid import UUID, uuid4

import psycopg

from services.db.supabase.tests.local_database import (
    DEFAULT_DATABASE_URL,
    assert_migrated_local_schema,
    require_local_supabase_url,
)
from services.sync.src.amazon.settlement_models import SettlementReportReference
from services.sync.src.amazon.settlement_parser import parse_settlement_report
from services.sync.src.database.company_sku_fee_rates import (
    CompanySkuFeeRate,
    FeeRateCursor,
    UnassignedSelboxFeeError,
    insert_company_sku_fee_rate,
    load_company_sku_fee_rates,
)
from services.sync.src.database.connection import DatabaseConnection
from services.sync.src.database.data_kiosk_economics import repository as provision_repository
from services.sync.src.database.data_kiosk_economics.models import DataKioskProvisionRefresh
from services.sync.src.database.data_kiosk_economics.repository import (
    persist_data_kiosk_provisions,
    prune_data_kiosk_provision_results,
)
from services.sync.src.database.fee_reference_checks import check_settlement_fee_references
from services.sync.src.database.settlement_report_repository import (
    SettlementReportPersistenceOutcome,
    persist_settlement_report,
)
from services.sync.src.database.settlement_report_selection_repository import (
    select_settlement_report_id,
)
from services.sync.src.numeric import Numeric
from services.sync.src.settlement_processing.artifacts import ProcessingArtifactLog
from services.sync.src.settlement_processing.models import (
    AuxiliaryFeeObservation,
    AuxiliaryRequirements,
    PreparedSettlement,
    SettlementProcessingPlan,
    StoredSettlementReport,
)
from services.sync.src.settlement_processing.planning import build_allocation_groups
from services.sync.src.settlement_processing.policy import SETTLEMENT_CATEGORY_RULES
from services.sync.src.settlement_processing.raw_report import prepare_settlement_report
from services.sync.src.settlement_processing.repository import (
    load_settlement_report,
    persist_settlement_processing,
)
from services.sync.src.settlement_processing.workflow import process_settlement_report
from services.sync.tests.support.economics import complete_economics_fact
from services.sync.tests.support.settlement_processing import (
    MARKETPLACE_ID,
    MARKETPLACE_NAME,
    stored_settlement_report,
)

_CA_MARKETPLACE_ID = "A2EUQ1WTGCTBG2"
_REFRESHED_AT = datetime(2026, 9, 5, tzinfo=UTC)


class _TransactionDatabase(DatabaseConnection):
    """Keep repository transactions inside the test's uncommitted transaction."""

    def __init__(self, connection: psycopg.Connection[tuple[object, ...]]) -> None:
        self._connection = connection

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> Literal[False]:
        return False

    def connection(self) -> AbstractContextManager[psycopg.Connection[tuple[object, ...]]]:
        # Returning the connection's own context manager would commit the outer transaction.
        return nullcontext(self._connection)


def _no_auxiliary(
    _settlement: PreparedSettlement,
    requirements: AuxiliaryRequirements,
    _artifacts: ProcessingArtifactLog,
) -> tuple[AuxiliaryFeeObservation, ...]:
    if requirements.any:
        raise AssertionError("The synthetic direct report must not request Amazon evidence.")
    return ()


@unittest.skipUnless(
    os.environ.get("RUN_LOCAL_SUPABASE_TESTS") == "1",
    "Set RUN_LOCAL_SUPABASE_TESTS=1 to run rollback-only local Supabase checks.",
)
class TestWorkflowRepositories(unittest.TestCase):
    def setUp(self) -> None:
        require_local_supabase_url(DEFAULT_DATABASE_URL)
        self.connection: psycopg.Connection[tuple[object, ...]] = psycopg.connect(
            DEFAULT_DATABASE_URL, autocommit=False, connect_timeout=5
        )
        self.addCleanup(self.connection.close)
        self.addCleanup(self.connection.rollback)
        # This read starts the outer transaction before repositories create savepoints.
        assert_migrated_local_schema(self.connection)
        self.database = _TransactionDatabase(self.connection)
        self.seller = f"repository-test-{uuid4()}"
        self.company_id = str(uuid4())
        self.fee_rate_id = str(uuid4())
        self.connection.execute(
            "insert into public.companies (id, company_name) values (%s::uuid, %s)",
            (self.company_id, self.seller),
        )
        self.connection.execute(
            """
            insert into public.company_sku_fee_rates (
                id, seller_namespace, marketplace_id, sku, company_id,
                fee_rate_percent, valid_period
            ) values (%s::uuid, %s, %s, 'SKU-1', %s::uuid, 5, '[2026-08-01,2026-09-01)')
            """,
            (self.fee_rate_id, self.seller, MARKETPLACE_ID, self.company_id),
        )

    def tearDown(self) -> None:
        # Exercise commit-time checks without ever committing synthetic fixtures.
        self.connection.execute("set constraints all immediate")

    def _persist_raw_report(self) -> StoredSettlementReport:
        fixture = stored_settlement_report()
        columns = (*fixture.columns, " extra-header ")
        metadata = [*fixture.metadata_values, "  exact metadata cell  "]
        metadata[columns.index("total-amount")] = "8.1234567890123456788"
        content: list[tuple[str, ...]] = []
        for row, amount in zip(
            fixture.rows, ("10.1234567890123456789", "-2.0000000000000000001"), strict=True
        ):
            values = [*row.values, "  exact content cell  "]
            values[columns.index("amount")] = amount
            if amount.startswith("-"):
                values[columns.index("quantity-purchased")] = ""
            content.append(tuple(values))
        document = "\n".join("\t".join(row) for row in (columns, metadata, *content)) + "\n"
        parsed = parse_settlement_report(document.encode())
        reference = SettlementReportReference(
            report_id=f"report-{uuid4()}",
            report_document_id=f"document-{uuid4()}",
            report_created_at=_REFRESHED_AT,
            marketplace_ids=(MARKETPLACE_ID,),
        )
        outcome = persist_settlement_report(
            self.database,
            parsed,
            reference,
            marketplace_names_by_id={MARKETPLACE_ID: MARKETPLACE_NAME},
            seller_namespace=self.seller,
            amazon_scope="NA",
        )
        self.assertEqual(outcome, SettlementReportPersistenceOutcome.INSERTED)
        report_id = select_settlement_report_id(self.database, seller_namespace=self.seller)
        if report_id is None:
            self.fail("The inserted synthetic report was not selected.")
        loaded = load_settlement_report(self.database, report_id)
        self.assertEqual(loaded.columns, columns)
        self.assertEqual(loaded.metadata_values, tuple(metadata))
        self.assertEqual(tuple(row.values for row in loaded.rows), tuple(content))
        self.assertEqual(tuple(row.source_line_number for row in loaded.rows), (3, 4))
        return loaded

    def test_settlement_round_trip_preserves_exact_results_and_appends_runs(self) -> None:
        report = self._persist_raw_report()
        with TemporaryDirectory() as temporary_directory:
            results = [
                process_settlement_report(
                    self.database,
                    _no_auxiliary,
                    seller_namespace=self.seller,
                    artifact_root=Path(temporary_directory),
                    settlement_report_id=report_id,
                )
                for report_id in (None, report.id)
            ]
        self.assertTrue(all(result.processed_entry_count == 2 for result in results))
        self.assertTrue(all(result.processed_result_count == 2 for result in results))
        self.assertNotEqual(results[0].processing_log_id, results[1].processing_log_id)
        self.assertIsNone(select_settlement_report_id(self.database, seller_namespace=self.seller))
        rows = self.connection.execute(
            """
            select category_code, company_id::text, company_sku_fee_rate_id::text,
                settlement_amount, elaborated_amount, difference_amount, selbox_fee_base,
                applied_fee_rate_percent, selbox_fee, company_payable,
                settlement_quantity, elaborated_quantity, difference_quantity,
                selbox_fee_base_quantity, selbox_fee_quantity, company_payable_quantity
            from private.settlement_processed_results
            where processing_log_id = %s::uuid
            order by category_code
            """,
            (results[0].processing_log_id,),
        ).fetchall()
        sale = Decimal("10.1234567890123456789")
        refund = Decimal("-2.0000000000000000001")
        self.assertEqual(
            rows,
            [
                (
                    "PRODUCT_REFUNDS",
                    self.company_id,
                    self.fee_rate_id,
                    refund,
                    refund,
                    Decimal(0),
                    Decimal(0),
                    Decimal(5),
                    Decimal(0),
                    refund,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                ),
                (
                    "PRODUCT_SALES",
                    self.company_id,
                    self.fee_rate_id,
                    sale,
                    sale,
                    Decimal(0),
                    sale,
                    Decimal(5),
                    Decimal("-0.506172839450617283945"),
                    Decimal("9.617283949561728394955"),
                    Decimal(1),
                    Decimal(1),
                    None,
                    Decimal(1),
                    Decimal(1),
                    Decimal(1),
                ),
            ],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.settlement_processing_logs "
                "where settlement_report_id = %s::uuid",
                (report.id,),
            ).fetchone(),
            (2,),
        )

    def test_failed_settlement_insert_rolls_back_every_processed_table(self) -> None:
        report = self._persist_raw_report()
        prepared = prepare_settlement_report(report, id_factory=lambda: str(uuid4()))
        groups = build_allocation_groups(
            prepared.ledger_entries,
            SETTLEMENT_CATEGORY_RULES,
            (),
            (),
            prepared.transaction_start_date,
            prepared.transaction_end_date_exclusive,
            lambda: str(uuid4()),
        )
        plan = SettlementProcessingPlan(
            processing_log_id=str(uuid4()),
            processor_version="repository-integration-test",
            settlement=prepared,
            groups=tuple(replace(group, currency="INVALID") for group in groups),
        )
        with self.assertRaises(psycopg.errors.CheckViolation):
            persist_settlement_processing(self.database, plan)
        self.assertEqual(
            self.connection.execute(
                """
                select
                    (select count(*) from private.settlement_processing_logs
                     where id = %(id)s::uuid),
                    (select count(*) from private.settlement_processed_reports
                     where processing_log_id = %(id)s::uuid),
                    (select count(*) from private.settlement_processed_entries
                     where processing_log_id = %(id)s::uuid),
                    (select count(*) from private.settlement_processed_results
                     where processing_log_id = %(id)s::uuid)
                """,
                {"id": plan.processing_log_id},
            ).fetchone(),
            (0, 0, 0, 0),
        )
        self.assertEqual(load_settlement_report(self.database, report.id), report)

    def test_fee_versions_warn_for_current_runs_and_reprocessing_clears_them(self) -> None:
        report = self._persist_raw_report()
        # The outer rollback transaction fixes timestamps, so increasing IDs
        # select successive fee versions and whole processing runs deterministically.
        identifiers = count(uuid4().int & ~255)
        with TemporaryDirectory() as temporary_directory:

            def process() -> str:
                result = process_settlement_report(
                    self.database,
                    _no_auxiliary,
                    seller_namespace=self.seller,
                    artifact_root=Path(temporary_directory),
                    settlement_report_id=report.id,
                    id_factory=lambda: str(UUID(int=next(identifiers))),
                )
                if result.processing_log_id is None:
                    self.fail("The synthetic report must produce a processing log.")
                return result.processing_log_id

            first_log_id = process()
            original_rows = self.connection.execute(
                "select id, company_sku_fee_rate_id, selbox_fee "
                "from private.settlement_processed_results where processing_log_id = %s::uuid "
                "order by id",
                (first_log_id,),
            ).fetchall()
            narrower = CompanySkuFeeRate(
                id=str(UUID(int=UUID(self.fee_rate_id).int + 1)),
                seller_namespace=self.seller,
                marketplace_id=MARKETPLACE_ID,
                sku="SKU-1",
                company_id=self.company_id,
                fee_rate_percent=Numeric(7),
                valid_from=date(2026, 8, 10),
                valid_to=date(2026, 9, 1),
            )
            with self.assertLogs(level="WARNING") as logged:
                self.assertEqual(insert_company_sku_fee_rate(self.database, narrower), narrower.id)
            self.assertEqual(len(logged.records), 1)
            self.assertIn(report.id, logged.output[0])
            for scope in ({"processing_log_id": first_log_id}, {"fee_rate_id": narrower.id}):
                with self.assertLogs(level="WARNING"):
                    self.assertEqual(
                        check_settlement_fee_references(self.database, **scope), (report.id,)
                    )
            with self.assertLogs(level="WARNING"):
                self.assertIn(report.id, check_settlement_fee_references(self.database) or ())
            with self.connection.cursor() as cursor:
                self.assertEqual(
                    load_company_sku_fee_rates(
                        cast(FeeRateCursor, cursor),
                        seller_namespace=self.seller,
                        marketplace_skus=((MARKETPLACE_ID, "SKU-1"),),
                        activity_date_from=date(2026, 8, 2),
                        activity_date_to=date(2026, 8, 2),
                    ),
                    (),
                )

            with self.assertLogs(level="ERROR"), self.assertRaises(UnassignedSelboxFeeError):
                process()
            self.assertEqual(
                self.connection.execute(
                    "select count(*) from private.settlement_processing_logs "
                    "where settlement_report_id = %s::uuid",
                    (report.id,),
                ).fetchone(),
                (1,),
            )

            # Bypass workflow validation to represent a historical/manual NULL
            # assignment. The database and stale-reference audit still allow it.
            prepared = prepare_settlement_report(
                report, id_factory=lambda: str(UUID(int=next(identifiers)))
            )
            groups = build_allocation_groups(
                prepared.ledger_entries,
                SETTLEMENT_CATEGORY_RULES,
                (),
                (),
                prepared.transaction_start_date,
                prepared.transaction_end_date_exclusive,
                lambda: str(UUID(int=next(identifiers))),
            )
            missing_log_id = str(UUID(int=next(identifiers)))
            persist_settlement_processing(
                self.database,
                SettlementProcessingPlan(
                    processing_log_id=missing_log_id,
                    processor_version="repository-integration-test",
                    settlement=prepared,
                    groups=tuple(
                        replace(
                            group,
                            targets=tuple(
                                replace(
                                    target,
                                    activity_start_date=date(2026, 8, 1),
                                    activity_end_date=date(2026, 8, 31),
                                )
                                for target in group.targets
                            ),
                        )
                        for group in groups
                    ),
                ),
            )
            self.assertEqual(
                check_settlement_fee_references(self.database, processing_log_id=first_log_id), ()
            )
            for scope in ({"processing_log_id": missing_log_id}, {"fee_rate_id": narrower.id}):
                with self.assertNoLogs(level="WARNING"):
                    self.assertEqual(check_settlement_fee_references(self.database, **scope), ())
            self.assertNotIn(report.id, check_settlement_fee_references(self.database) or ())
            zero_rate = replace(
                narrower,
                id=str(UUID(int=UUID(narrower.id).int + 1)),
                valid_from=date(2026, 8, 1),
                fee_rate_percent=Numeric(0),
            )
            # A new rate does not invalidate the intentional NULL fee assignment.
            with self.assertNoLogs(level="WARNING"):
                insert_company_sku_fee_rate(self.database, zero_rate)
            for scope in ({"processing_log_id": missing_log_id}, {"fee_rate_id": zero_rate.id}):
                with self.assertNoLogs(level="WARNING"):
                    self.assertEqual(check_settlement_fee_references(self.database, **scope), ())
            self.assertNotIn(report.id, check_settlement_fee_references(self.database) or ())
            final_log_id = process()
            self.assertEqual(
                check_settlement_fee_references(self.database, processing_log_id=final_log_id), ()
            )
            self.assertEqual(
                check_settlement_fee_references(self.database, fee_rate_id=zero_rate.id), ()
            )
            self.assertNotIn(report.id, check_settlement_fee_references(self.database) or ())
            self.assertEqual(
                self.connection.execute(
                    "select company_id::text, company_sku_fee_rate_id::text, selbox_fee "
                    "from private.latest_settlement_processed_results "
                    "where settlement_report_id = %s::uuid",
                    (report.id,),
                ).fetchall(),
                [(self.company_id, zero_rate.id, Decimal(0))] * 2,
            )
            self.assertEqual(
                self.connection.execute(
                    "select id, company_sku_fee_rate_id, selbox_fee "
                    "from private.settlement_processed_results "
                    "where processing_log_id = %s::uuid order by id",
                    (first_log_id,),
                ).fetchall(),
                original_rows,
            )

    def test_provision_history_current_selection_and_retention(self) -> None:
        self.connection.execute(
            """
            insert into public.company_sku_fee_rates (
                seller_namespace, marketplace_id, sku, company_id, fee_rate_percent, valid_period
            ) values (%s, %s, 'SKU-1', %s::uuid, 0, '[2026-08-01,2026-09-01)')
            """,
            (self.seller, _CA_MARKETPLACE_ID, self.company_id),
        )
        refresh = DataKioskProvisionRefresh(
            seller_namespace=self.seller,
            amazon_scope="NA",
            marketplace_ids=(MARKETPLACE_ID, _CA_MARKETPLACE_ID),
            facts=(
                complete_economics_fact(),
                complete_economics_fact(marketplace_id=_CA_MARKETPLACE_ID, currency="CAD"),
            ),
            refreshed_at=_REFRESHED_AT,
        )
        # All nested transactions share processed_at; ascending UUIDs exercise
        # the same deterministic tie-breaker as the Settlement views.
        log_id_base = uuid4().int & ~3
        with patch.object(provision_repository, "uuid4", return_value=UUID(int=log_id_base)):
            result = persist_data_kiosk_provisions(self.database, refresh)
        self.assertEqual(result.provision_row_count, 2)
        self.assertEqual(
            self.connection.execute(
                """
                select company_id::text, company_sku_fee_rate_id::text,
                    product_sales, product_refunds, net_product_sales,
                    amazon_fee_total, advertising_total, selbox_fee_base, selbox_fee,
                    product_sales_quantity, product_refunds_quantity,
                    net_product_sales_quantity, selbox_fee_base_quantity, selbox_fee_quantity,
                    amazon_fee_total_quantity, advertising_total_quantity,
                    net_proceeds_total_quantity,
                    fee_breakdown->0->'aggregated_detail'->'total_amount'->>'amount',
                    fee_breakdown->0->'aggregated_detail'->>'quantity'
                from private.data_kiosk_provisions
                where seller_namespace = %s and marketplace_id = %s
                """,
                (self.seller, MARKETPLACE_ID),
            ).fetchone(),
            (
                self.company_id,
                self.fee_rate_id,
                Decimal("30.375"),
                Decimal("10.125"),
                Decimal("20.25"),
                Decimal("2.5000000000000000001"),
                Decimal("1.005"),
                Decimal("30.375"),
                Decimal("-1.51875"),
                Decimal(3),
                Decimal(1),
                Decimal(2),
                Decimal(3),
                Decimal(3),
                Decimal(2),
                Decimal(2),
                None,
                "2.5000000000000000001",
                "2",
            ),
        )
        selected_refresh = replace(
            refresh,
            marketplace_ids=(MARKETPLACE_ID,),
            facts=(complete_economics_fact(activity_date=date(2026, 8, 2)),),
        )
        with patch.object(provision_repository, "uuid4", return_value=UUID(int=log_id_base + 1)):
            second = persist_data_kiosk_provisions(self.database, selected_refresh)
        self.assertEqual(
            self.connection.execute(
                "select marketplace_id, activity_date from private.latest_data_kiosk_provisions "
                "where seller_namespace = %s order by marketplace_id",
                (self.seller,),
            ).fetchall(),
            [(_CA_MARKETPLACE_ID, date(2026, 8, 1)), (MARKETPLACE_ID, date(2026, 8, 2))],
        )
        with patch.object(provision_repository, "uuid4", return_value=UUID(int=log_id_base + 2)):
            empty = persist_data_kiosk_provisions(
                self.database, replace(selected_refresh, facts=())
            )
        self.assertEqual(
            self.connection.execute(
                "select marketplace_id from private.latest_data_kiosk_provisions "
                "where seller_namespace = %s",
                (self.seller,),
            ).fetchall(),
            [(_CA_MARKETPLACE_ID,)],
        )
        self.assertEqual(
            self.connection.execute(
                "select id::text, provision_row_count "
                "from private.data_kiosk_provision_processing_logs "
                "where seller_namespace = %s order by id",
                (self.seller,),
            ).fetchall(),
            [
                (result.processing_log_id, 2),
                (second.processing_log_id, 1),
                (empty.processing_log_id, 0),
            ],
        )
        # The empty run counts toward retention; CA's sole batch stays current.
        for keep_latest, expected_deleted in ((2, 1), (1, 1), (1, 0)):
            self.assertEqual(
                prune_data_kiosk_provision_results(
                    self.database,
                    seller_namespace=self.seller,
                    amazon_scope="NA",
                    keep_latest=keep_latest,
                ),
                expected_deleted,
            )
        self.assertEqual(
            self.connection.execute(
                "select marketplace_id from private.data_kiosk_provisions "
                "where seller_namespace = %s",
                (self.seller,),
            ).fetchall(),
            [(_CA_MARKETPLACE_ID,)],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_provision_processing_logs "
                "where seller_namespace = %s",
                (self.seller,),
            ).fetchone(),
            (3,),
        )

    def test_failed_provision_insert_restores_previous_partition(self) -> None:
        refresh = DataKioskProvisionRefresh(
            seller_namespace=self.seller,
            amazon_scope="NA",
            marketplace_ids=(MARKETPLACE_ID,),
            facts=(complete_economics_fact(),),
            refreshed_at=_REFRESHED_AT,
        )
        persist_data_kiosk_provisions(self.database, refresh)
        invalid = complete_economics_fact(activity_date=date(2026, 8, 2), currency="INVALID")
        with self.assertRaises(psycopg.errors.CheckViolation):
            persist_data_kiosk_provisions(self.database, replace(refresh, facts=(invalid,)))
        missing_rate = replace(complete_economics_fact(), msku="SKU-2")
        with self.assertLogs(level="ERROR"), self.assertRaises(UnassignedSelboxFeeError):
            persist_data_kiosk_provisions(
                self.database, replace(refresh, facts=(*refresh.facts, missing_rate))
            )
        self.assertEqual(
            self.connection.execute(
                "select activity_date, currency, product_sales, selbox_fee "
                "from private.data_kiosk_provisions where seller_namespace = %s",
                (self.seller,),
            ).fetchall(),
            [(date(2026, 8, 1), "USD", Decimal("30.375"), Decimal("-1.51875"))],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.data_kiosk_provision_processing_logs "
                "where seller_namespace = %s",
                (self.seller,),
            ).fetchone(),
            (1,),
        )


if __name__ == "__main__":
    unittest.main()
