import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.amazon import (
    ReportsClientFactory,
    get_endpoint_marketplaces,
    parse_settlement_report,
    validate_endpoint,
)
from src.amazon.models import (
    ParsedSettlement,
    ParsedSettlementReport,
    ParsedSettlementTransaction,
)
from src.database import (
    insert_settlement_report,
    preprocess_no_sku_transactions,
    preprocess_order_transactions,
)
from src.settlements import sync_settlement_reports
from src.test.fakes import FakeDatabaseConnection


def make_report_text() -> str:
    """Return a small settlement TSV fixture with metadata and transaction rows."""
    headers = [
        "settlement-id",
        "settlement-start-date",
        "settlement-end-date",
        "deposit-date",
        "total-amount",
        "currency",
        "transaction-type",
        "order-id",
        "merchant-order-id",
        "adjustment-id",
        "shipment-id",
        "marketplace-name",
        "amount-type",
        "amount-description",
        "amount",
        "fulfillment-id",
        "posted-date",
        "posted-date-time",
        "order-item-code",
        "merchant-order-item-id",
        "merchant-adjustment-item-id",
        "sku",
        "quantity-purchased",
        "promotion-id",
    ]
    rows = [
        [
            "26169742111",
            "15.04.2026 06:33:36 UTC",
            "29.04.2026 06:33:37 UTC",
            "01.05.2026 06:33:37 UTC",
            "-58.54",
            "CAD",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        ],
        [
            "26169742111",
            "",
            "",
            "",
            "",
            "",
            "other-transaction",
            "",
            "",
            "",
            "",
            "",
            "other-transaction",
            "Payable to Amazon",
            "-14.39",
            "",
            "15.04.2026",
            "15.04.2026 06:33:36 UTC",
            "",
            "",
            "",
            "",
            "",
            "",
        ],
        [
            "26169742111",
            "",
            "",
            "",
            "",
            "",
            "Order",
            "702-1234567-1234567",
            "702-1234567-1234567",
            "",
            "shipment-1",
            "Amazon.ca",
            "ItemPrice",
            "Principal",
            "10.00",
            "AFN",
            "16.04.2026",
            "16.04.2026 00:10:00 UTC",
            "order-item-1",
            "",
            "",
            "SKU-1",
            "1",
            "",
        ],
    ]
    return "\n".join(["\t".join(headers), *["\t".join(row) for row in rows]]) + "\n"


def write_report(path: Path) -> None:
    """Write the in-memory TSV fixture to disk for parser tests."""
    path.write_text(make_report_text(), encoding="utf-8")


def make_parsed_settlement_report() -> ParsedSettlementReport:
    """Build a typed parsed settlement report for insert tests."""
    return ParsedSettlementReport(
        settlement=ParsedSettlement(
            amz_region="NA",
            amz_settlement_id="26169742111",
            amz_document_id="document-1",
            amz_settlement_start_date="15.04.2026 06:33:36 UTC",
            amz_settlement_end_date="29.04.2026 06:33:37 UTC",
            amz_deposit_date="01.05.2026 06:33:37 UTC",
            amz_total_amount="-58.54",
            amz_currency="CAD",
        ),
        transactions=[
            ParsedSettlementTransaction(
                amz_report_line_no=3,
                amz_transaction_type="other-transaction",
                amz_order_id=None,
                amz_merchant_order_id=None,
                amz_adjustment_id=None,
                amz_shipment_id=None,
                amz_marketplace_name=None,
                amz_amount_type="other-transaction",
                amz_amount_description="Payable to Amazon",
                amz_amount="-14.39",
                amz_fulfillment_id=None,
                amz_posted_date="15.04.2026",
                amz_posted_date_time="15.04.2026 06:33:36 UTC",
                amz_order_item_code=None,
                amz_merchant_order_item_id=None,
                amz_merchant_adjustment_item_id=None,
                amz_sku=None,
                amz_quantity_purchased=None,
                amz_promotion_id=None,
            )
        ],
    )


class FakeResponse:
    def __init__(
        self,
        payload: dict[str, object],
        next_token: str | None,
    ) -> None:
        """Store the minimal ApiResponse fields used by pagination code."""
        self.payload = payload
        self.next_token = next_token
        self.rate_limit = None


class FakeClient:
    def __init__(self, report_text: str) -> None:
        """Create a fake Reports client that records API calls."""
        self.report_text = report_text
        self.get_reports_calls: list[dict[str, object]] = []
        self.downloads: list[tuple[str, bool, str]] = []
        self.closed = False

    def get_reports(self, **kwargs: object) -> FakeResponse:
        """Return one completed settlement report from the fake client."""
        self.get_reports_calls.append(kwargs)
        return FakeResponse(
            {
                "reports": [
                    {
                        "reportId": "report-1",
                        "reportDocumentId": "document-1",
                    }
                ]
            },
            None,
        )

    def get_report_document(
        self,
        report_document_id: str,
        download: bool,
        file: str,
    ) -> FakeResponse:
        """Write the fake report text to the requested download path."""
        self.downloads.append((report_document_id, download, file))
        Path(file).write_text(self.report_text, encoding="utf-8")
        return FakeResponse({"reportDocumentId": report_document_id}, None)

    def close(self) -> None:
        """Record that sync closed the fake Reports client."""
        self.closed = True


class TestSettlementSync(unittest.TestCase):
    def test_get_endpoint_marketplaces_accepts_exact_endpoint(self) -> None:
        """Check that an exact endpoint maps to expected marketplace IDs."""
        marketplaces = get_endpoint_marketplaces("NA")

        marketplace_ids = [marketplace.marketplace_id for marketplace in marketplaces]
        self.assertIn("ATVPDKIKX0DER", marketplace_ids)
        self.assertIn("A2EUQ1WTGCTBG2", marketplace_ids)

    def test_validate_endpoint_rejects_non_exact_input(self) -> None:
        """Check that lowercase values and endpoint URLs are rejected."""
        with self.assertRaises(ValueError):
            validate_endpoint("na")

        with self.assertRaises(ValueError):
            validate_endpoint("https://sellingpartnerapi-eu.amazon.com")

    def test_reports_client_factory_validates_and_creates_client(self) -> None:
        """Check that the Reports factory stores validated SP-API settings."""
        with patch("src.amazon.client.Reports") as reports_class:
            factory = ReportsClientFactory("NA", "refresh-token")

            client = factory.create()

        self.assertEqual(client, reports_class.return_value)
        self.assertEqual(factory.amazon_endpoint, "NA")
        reports_class.assert_called_once()
        self.assertEqual(reports_class.call_args.kwargs["refresh_token"], "refresh-token")
        self.assertEqual(
            reports_class.call_args.kwargs["marketplace"].marketplace_id,
            "ATVPDKIKX0DER",
        )

    def test_reports_client_factory_rejects_empty_refresh_token(self) -> None:
        """Check that Reports factory construction requires an explicit token."""
        with self.assertRaises(ValueError):
            ReportsClientFactory("NA", "")

    def test_parse_settlement_report_maps_first_record_and_transactions(self) -> None:
        """Check that parser splits settlement metadata from transaction rows."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            report_path = Path(tmp_dir) / "report-1.tsv"
            write_report(report_path)

            parsed_report = parse_settlement_report(
                report_path,
                amazon_endpoint="NA",
                report_document_id="document-1",
            )

        self.assertEqual(parsed_report.settlement.amz_region, "NA")
        self.assertEqual(parsed_report.settlement.amz_document_id, "document-1")
        self.assertEqual(parsed_report.settlement.amz_settlement_id, "26169742111")
        self.assertEqual(parsed_report.settlement.amz_total_amount, "-58.54")
        self.assertEqual(parsed_report.settlement.amz_currency, "CAD")

        self.assertEqual(len(parsed_report.transactions), 2)
        self.assertEqual(parsed_report.transactions[0].amz_report_line_no, 3)
        self.assertEqual(
            parsed_report.transactions[0].amz_transaction_type,
            "other-transaction",
        )
        self.assertIsNone(parsed_report.transactions[0].amz_order_id)
        self.assertEqual(parsed_report.transactions[1].amz_sku, "SKU-1")

    def test_parse_settlement_report_rejects_blank_required_transaction_field(
        self,
    ) -> None:
        """Check that required transaction columns cannot be blank."""
        lines = make_report_text().splitlines()
        headers = lines[0].split("\t")
        transaction_row = lines[2].split("\t")
        transaction_row[headers.index("amount-type")] = ""
        lines[2] = "\t".join(transaction_row)

        with tempfile.TemporaryDirectory() as tmp_dir:
            report_path = Path(tmp_dir) / "report-1.tsv"
            report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(
                ValueError,
                "Missing required column amount-type",
            ):
                parse_settlement_report(
                    report_path,
                    amazon_endpoint="NA",
                    report_document_id="document-1",
                )

    def test_insert_settlement_report_inserts_settlement_and_transactions(self) -> None:
        """Check that successful settlement insert triggers transaction insert."""
        parsed_report = make_parsed_settlement_report()
        conn = FakeDatabaseConnection([("settlement-uuid-1",)])

        settlement_id = insert_settlement_report(conn, parsed_report)

        self.assertEqual(settlement_id, "settlement-uuid-1")
        self.assertIn("insert into private.settlements", conn.execute_calls[0][0])
        self.assertIn("private.settlement_transactions", conn.executemany_calls[0][0])
        self.assertEqual(
            conn.executemany_calls[0][1][0]["settlement_id"],
            "settlement-uuid-1",
        )

    def test_insert_settlement_report_skips_transactions_when_settlement_is_duplicate(
        self,
    ) -> None:
        """Check that duplicate settlement reports do not insert transactions."""
        parsed_report = make_parsed_settlement_report()
        conn = FakeDatabaseConnection([None])

        settlement_id = insert_settlement_report(conn, parsed_report)

        self.assertIsNone(settlement_id)
        self.assertEqual(len(conn.execute_calls), 1)
        self.assertIn("insert into private.settlements", conn.execute_calls[0][0])
        self.assertEqual(conn.executemany_calls, [])

    def test_preprocess_order_transactions_uses_explicit_metadata(self) -> None:
        """Check that order preprocessing records explicit run metadata."""
        conn = FakeDatabaseConnection(
            [
                ("order-run-1", 1),
                (2, 6),
            ]
        )

        result = preprocess_order_transactions(
            conn,
            "settlement-uuid-1",
            preprocess_version="order-v2",
            preprocess_description="manual order run",
        )

        self.assertEqual(result.preprocess_type, "order")
        self.assertEqual(result.preprocess_run_id, "order-run-1")
        self.assertEqual(result.inserted_count, 2)
        self.assertEqual(result.mapping_count, 6)
        self.assertEqual(result.marked_not_current_count, 1)
        self.assertEqual(conn.connection_count, 1)
        self.assertIn("private.order_transactions", conn.execute_calls[0][0])
        self.assertIn("private.order_transactions", conn.execute_calls[1][0])
        self.assertEqual(conn.execute_calls[0][1]["settlement_id"], "settlement-uuid-1")
        self.assertEqual(conn.execute_calls[0][1]["preprocess_version"], "order-v2")
        self.assertEqual(conn.execute_calls[0][1]["preprocess_description"], "manual order run")

    def test_preprocess_no_sku_transactions_uses_explicit_metadata(self) -> None:
        """Check that no-SKU preprocessing records explicit run metadata."""
        conn = FakeDatabaseConnection(
            [
                ("no-sku-run-1", 2),
                (3,),
            ]
        )

        result = preprocess_no_sku_transactions(
            conn,
            "settlement-uuid-1",
            preprocess_version="no-sku-v2",
            preprocess_description="manual no-sku run",
        )

        self.assertEqual(result.preprocess_type, "no_sku")
        self.assertEqual(result.preprocess_run_id, "no-sku-run-1")
        self.assertEqual(result.inserted_count, 3)
        self.assertEqual(result.marked_not_current_count, 2)
        self.assertEqual(conn.connection_count, 1)
        self.assertIn("private.no_sku_transactions", conn.execute_calls[0][0])
        self.assertIn("private.no_sku_transactions", conn.execute_calls[1][0])
        self.assertEqual(conn.execute_calls[0][1]["settlement_id"], "settlement-uuid-1")
        self.assertEqual(conn.execute_calls[0][1]["preprocess_version"], "no-sku-v2")
        self.assertEqual(conn.execute_calls[0][1]["preprocess_description"], "manual no-sku run")

    def test_sync_settlement_reports_downloads_parses_and_inserts(self) -> None:
        """Check the orchestration path with fake Amazon and database clients."""
        client = FakeClient(make_report_text())
        client_factory = ReportsClientFactory("NA", "refresh-token")
        fake_db = FakeDatabaseConnection([("settlement-uuid-1",)])

        with (
            tempfile.TemporaryDirectory() as tmp_dir,
            patch("src.amazon.client.Reports", return_value=client) as reports_class,
        ):
            inserted_ids = sync_settlement_reports(
                client_factory=client_factory,
                database=fake_db,
                days=7,
                output_dir=Path(tmp_dir),
            )

        self.assertEqual(inserted_ids, ["settlement-uuid-1"])
        reports_class.assert_called_once()
        self.assertEqual(fake_db.enter_count, 1)
        self.assertTrue(client.closed)
        self.assertEqual(client.get_reports_calls[0]["processingStatuses"], ["DONE"])
        self.assertEqual(client.get_reports_calls[0]["pageSize"], 100)
        self.assertEqual(client.downloads[0][0], "document-1")
        self.assertEqual(len(fake_db.execute_calls), 1)
        self.assertIn("insert into private.settlements", fake_db.execute_calls[0][0])


if __name__ == "__main__":
    unittest.main()
