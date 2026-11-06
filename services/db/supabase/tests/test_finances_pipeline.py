"""Successful Finance observations share immutable transaction state without day copies."""

import json
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal
from typing import cast

import psycopg

from services.db.supabase.tests.integration_support import DatabaseTestCase, TransactionDatabase
from services.db.supabase.tests.local_database import require_row
from services.sync.src.archives.storage import archive_document, load_document_archive
from services.sync.src.database.company_terms import create_company, publish_sku_terms
from services.sync.src.database.finances import publish_finances
from services.sync.src.finances.acquisition_models import ArchivedFinancesPage, FinancesAcquisition
from services.sync.src.finances.marketplaces import coverage_marketplaces
from services.sync.src.finances.models import PreparedFinances
from services.sync.src.finances.preprocess import prepare_finances_acquisition
from services.sync.src.finances.query_windows import transaction_query_parameters
from services.sync.src.numeric import Numeric
from services.sync.src.source_serialization import source_json
from services.sync.tests.support.archives import MemoryArchiveStorage
from services.sync.tests.support.finances import finances_acquisition, native_transaction


class FinancesPipelineTests(DatabaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.storage = MemoryArchiveStorage()
        self.database = TransactionDatabase(self.connection)
        self.observation = 0

    def capture(
        self, rows: list[dict[str, object]], summary: str | None = "100"
    ) -> tuple[FinancesAcquisition, PreparedFinances]:
        acquisition = finances_acquisition(self.storage, rows, summary_amount=summary)
        self.observation += 1
        at = acquisition.capture_started_at + timedelta(seconds=self.observation)
        acquisition = replace(
            acquisition,
            capture_started_at=at,
            downloaded_at=at,
            documents=tuple(
                replace(page, requested_at=at, received_at=at) for page in acquisition.documents
            ),
        )
        return acquisition, prepare_finances_acquisition(acquisition, self.storage)

    def accept(self, acquisition: FinancesAcquisition, prepared: PreparedFinances) -> str:
        result = publish_finances(self.database, acquisition, prepared)
        self.connection.execute("set constraints all immediate")
        self.connection.execute("set constraints all deferred")
        return result

    def counts(self) -> tuple[int, ...]:
        row = self.connection.execute(
            "select (select count(*) from private.finances_acquisitions),"
            "(select count(*) from private.finances_preprocess_batches),"
            "(select count(*) from private.finances_transactions),"
            "(select count(*) from private.finances_transaction_versions),"
            "(select count(*) from private.finances_transaction_components),"
            "(select count(*) from private.finances_preprocess_batch_transactions)"
        ).fetchone()
        return tuple(int(value) for value in require_row(row))

    def test_repeated_capture_reuses_state_and_records_its_own_observation_location(self) -> None:
        first = self.capture([native_transaction("A"), native_transaction("B")], "200")
        first_run = self.accept(*first)
        original = self.connection.execute(
            "select id,current_version_id from private.finances_transactions "
            "order by native_transaction_id"
        ).fetchall()
        second_run = self.accept(
            *self.capture([native_transaction("B"), native_transaction("A")], "200")
        )
        self.assertNotEqual(first_run, second_run)
        self.assertEqual(self.counts(), (2, 2, 2, 2, 2, 4))
        self.assertEqual(
            original,
            self.connection.execute(
                "select id,current_version_id from private.finances_transactions "
                "order by native_transaction_id"
            ).fetchall(),
        )
        self.assertEqual(
            self.connection.execute(
                "select m.source_record_number from "
                "private.finances_preprocess_batch_transactions m "
                "join private.finances_transactions t on t.id=m.transaction_id "
                "where t.native_transaction_id='A' order by m.batch_id"
            ).fetchall(),
            [(1,), (2,)],
        )
        self.assertEqual(
            self.connection.execute(
                "select count(*) from private.finances_transactions where current_batch_id=%s",
                (second_run,),
            ).fetchone(),
            (2,),
        )

    def test_changes_keep_every_revision_and_reverting_state_reuses_earlier_revision(self) -> None:
        for amount in range(100, 105):
            self.accept(*self.capture([native_transaction(amount=str(amount))], str(amount)))
        original = self.connection.execute(
            "select id from private.finances_transaction_versions where total_amount=100"
        ).fetchone()
        self.accept(*self.capture([native_transaction(amount="100.00")], "100"))
        self.assertEqual(self.counts(), (6, 6, 1, 5, 5, 6))
        self.assertEqual(
            original,
            self.connection.execute(
                "select current_version_id from private.finances_transactions"
            ).fetchone(),
        )
        self.assertEqual(
            self.connection.execute(
                "select total_amount from private.finances_transaction_versions "
                "order by total_amount"
            ).fetchall(),
            [(Decimal(value),) for value in range(100, 105)],
        )

    def test_native_status_change_is_a_revision_even_when_money_is_unchanged(self) -> None:
        self.accept(*self.capture([native_transaction()]))
        self.accept(
            *self.capture([native_transaction(status="DEFERRED_RELEASED", release="later")])
        )
        self.assertEqual(self.counts(), (2, 2, 1, 2, 2, 2))
        self.assertEqual(
            self.connection.execute(
                "select transaction_status from "
                "private.finances_transaction_versions order by created_at,id"
            ).fetchall(),
            [("DEFERRED",), ("DEFERRED_RELEASED",)],
        )

    def test_summary_missing_mismatch_or_bad_partition_leaves_no_success_rows(self) -> None:
        unavailable = self.capture([native_transaction()], None)
        mismatch = self.capture([native_transaction()], "99")
        acquisition, prepared = self.capture([native_transaction()])
        transaction = prepared.transactions[0]
        bad = replace(
            prepared,
            transactions=(
                replace(
                    transaction,
                    components=(replace(transaction.components[0], amount=Numeric(99)),),
                ),
            ),
        )
        for candidate in (unavailable, mismatch, (acquisition, bad)):
            with self.subTest(candidate=candidate[0].id), self.assertRaises(ValueError):
                self.accept(*candidate)
            self.assertEqual(self.counts(), (0, 0, 0, 0, 0, 0))

    def test_missing_accepted_transaction_is_an_error_not_a_delete(self) -> None:
        self.accept(*self.capture([native_transaction()]))
        before = self.counts()
        with self.assertRaisesRegex(ValueError, "missing from complete coverage"):
            self.accept(*self.capture([], "0"))
        self.assertEqual(self.counts(), before)
        self.assertEqual(
            self.connection.execute(
                "select total_amount from private.finances_transaction_versions"
            ).fetchone(),
            (Decimal(100),),
        )

    def test_empty_success_keeps_coverage_and_prevents_older_replacement(self) -> None:
        older = self.capture([native_transaction()])
        self.accept(*self.capture([], "0"))
        self.assertEqual(self.counts(), (1, 1, 0, 0, 0, 0))
        with self.assertRaisesRegex(ValueError, "older Finances capture"):
            self.accept(*older)
        self.assertEqual(self.counts(), (1, 1, 0, 0, 0, 0))

    def test_reprocessing_same_acquisition_adds_membership_without_copying_payload(self) -> None:
        acquisition, prepared = self.capture([native_transaction()])
        self.accept(acquisition, prepared)
        publish_finances(self.database, acquisition, prepared, preprocess_version="another-parser")
        self.connection.execute("set constraints all immediate")
        self.assertEqual(self.counts(), (1, 2, 1, 1, 1, 2))

    def test_schema_failure_after_inserts_rolls_back_acquisition_run_and_payload(self) -> None:
        acquisition, prepared = self.capture([native_transaction()])
        self.connection.execute("""
            create function pg_temp.reject_test_component() returns trigger language plpgsql as $$
            begin raise exception 'Synthetic late insertion failure' using errcode='23514'; end $$;
            create trigger reject_test_component
            before insert on private.finances_transaction_components
            for each row execute function pg_temp.reject_test_component();
        """)
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.accept(acquisition, prepared)
        self.assertEqual(self.counts(), (0, 0, 0, 0, 0, 0))

    def test_revision_components_and_memberships_cannot_be_rewritten_or_removed(self) -> None:
        self.accept(*self.capture([native_transaction()]))
        statements = (
            "update private.finances_transaction_versions set total_amount=101",
            "delete from private.finances_transaction_versions",
            "truncate private.finances_transaction_components",
            "update private.finances_transaction_components set amount=101",
            "delete from private.finances_preprocess_batch_transactions",
            "update private.finances_preprocess_batches set transaction_count=0",
        )
        for statement in statements:
            with (
                self.subTest(statement=statement),
                self.assertRaises(psycopg.Error),
                self.connection.transaction(),
            ):
                self.connection.execute(statement)
        self.assertEqual(self.counts(), (1, 1, 1, 1, 1, 1))

    def test_revisions_have_no_originating_run_or_raw_json_columns(self) -> None:
        columns = {
            row[0]
            for row in self.connection.execute(
                "select column_name from information_schema.columns "
                "where table_schema='private' and table_name='finances_transaction_versions'"
            )
        }
        self.assertFalse(
            {"batch_id", "acquisition_id", "source_fields", "source_page_number"} & columns
        )
        self.assertIn("transaction_id", columns)
        self.assertIn("content_sha256", columns)

    def test_same_native_id_is_independent_between_sellers(self) -> None:
        first, prepared = self.capture([native_transaction()])
        self.accept(first, prepared)
        second, other = self.capture([native_transaction()])
        self.accept(replace(second, seller_namespace="another-seller"), other)
        self.assertEqual(self.counts(), (2, 2, 2, 2, 2, 2))

    def test_linked_release_and_transfer_do_not_add_new_activity(self) -> None:
        rows = [
            native_transaction("A", release="B"),
            native_transaction("B", status="RELEASED", original="A"),
        ]
        self.accept(*self.capture(rows, "100"))
        self.assertEqual(
            self.connection.execute(
                "select sum(total_amount),sum(total_amount) filter(where activity_eligible) "
                "from private.finances_transaction_versions"
            ).fetchone(),
            (Decimal(200), Decimal(100)),
        )

    def test_bulk_capture_has_one_complete_membership_for_each_transaction(self) -> None:
        rows = [native_transaction(str(index), amount="1") for index in range(1000)]
        self.accept(*self.capture(rows, "1000"))
        self.assertEqual(self.counts(), (1, 1, 1000, 1000, 1000, 1000))

    def completed_old_month(self) -> str:
        company = create_company(self.database, "Refresh scope company")
        publish_sku_terms(
            self.database,
            sku="SKU-1",
            company_id=company,
            expected_current_version_id=None,
            periods=[],
            change_reason="Own observed SKU",
        )
        self.connection.execute(
            "INSERT INTO private.payout_report_refresh_state "
            "(company_id,month,requested_revision,completed_revision) VALUES "
            "(%s,'2026-07-01',17,17) "
            "ON CONFLICT(company_id,month) DO UPDATE SET "
            "requested_revision=17,completed_revision=17",
            (company,),
        )
        return company

    def old_month_revisions(self, company: str) -> tuple[object, ...]:
        return require_row(
            self.connection.execute(
                "SELECT requested_revision,completed_revision FROM "
                "private.payout_report_refresh_state "
                "WHERE company_id=%s AND month='2026-07-01'",
                (company,),
            ).fetchone()
        )

    def test_new_native_id_with_known_sku_does_not_requeue_completed_older_months(self) -> None:
        self.accept(*self.capture([native_transaction("A")]))
        company = self.completed_old_month()
        self.accept(*self.capture([native_transaction("A"), native_transaction("B")], "200"))
        self.assertEqual(self.old_month_revisions(company), (17, 17))
        self.assertEqual(
            self.connection.execute(
                "SELECT requested_revision>completed_revision FROM "
                "private.payout_report_refresh_state "
                "WHERE company_id=%s AND month='2026-08-01'",
                (company,),
            ).fetchone(),
            (True,),
        )

    def test_new_sku_on_existing_native_id_requeues_historical_scope(self) -> None:
        self.accept(*self.capture([native_transaction("A")]))
        company = self.completed_old_month()
        changed = native_transaction("A")
        item = cast(list[dict[str, object]], changed["items"])[0]
        cast(list[dict[str, object]], item["contexts"])[0]["sku"] = "new-observed-sku"
        self.accept(*self.capture([changed]))
        self.assertEqual(self.old_month_revisions(company), (18, 17))

    def test_new_empty_marketplace_coverage_requeues_historical_scope(self) -> None:
        self.accept(*self.capture([native_transaction("A")]))
        company = self.completed_old_month()
        acquisition, _ = self.capture([], "0")
        market = coverage_marketplaces("NA", ("A2EUQ1WTGCTBG2",))[0]
        documents: list[ArchivedFinancesPage] = []
        for page in acquisition.documents:
            if page.operation == "summary":
                body = json.loads(load_document_archive(self.storage, page.document))
                body["summaries"][0]["partnerMetadata"]["marketplaceId"] = market.marketplace_id
                page = replace(
                    page,
                    document=archive_document(
                        self.storage, json.dumps(body).encode(), source_compression=None
                    ),
                )
            else:
                page = replace(
                    page,
                    request_parameters=transaction_query_parameters(
                        (market,),
                        acquisition.query_start_date,
                        acquisition.query_end_date,
                        observed_at=acquisition.capture_started_at,
                    ),
                )
            documents.append(page)
        acquisition = replace(
            acquisition,
            marketplace_ids=(market.marketplace_id,),
            api_metadata={
                "summary_available": True,
                "coverage_marketplaces": [source_json(market)],
            },
            documents=tuple(documents),
        )
        self.accept(acquisition, prepare_finances_acquisition(acquisition, self.storage))
        self.assertEqual(self.old_month_revisions(company), (18, 17))
