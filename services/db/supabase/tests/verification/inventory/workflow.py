"""Opt-in real SP-API → archive → offline preprocessing → DB → Auth/REST → browser check."""

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

from dotenv import load_dotenv
from psycopg.rows import dict_row

from services.sync.src.amazon.client import create_reports_client
from services.sync.src.amazon.credentials import close_quietly, load_lwa_credentials
from services.sync.src.amazon.marketplaces import get_credential_scope
from services.sync.src.archives.storage import SupabaseArchiveStorage, load_document_archive
from services.sync.src.database.acquisitions import load_inventory_acquisition
from services.sync.src.database.connection import PostgresDatabaseConnection
from services.sync.src.inventory.acquisition import download_inventory_acquisition
from services.sync.src.inventory.parser import prepare_inventory_report
from services.sync.src.inventory.reports import InventoryReportsClient
from services.sync.src.inventory.workflow import preprocess_inventory_acquisition

from ...e2e.local_stack import LocalSupabaseStack
from .accounts import prepare_accounts
from .browser import verify_browser
from .checks import require


def verify(
    *,
    env_file: Path,
    scope_name: str,
    marketplace_id: str,
    report_reference: Path | None,
    private_output: Path,
) -> dict[str, object]:
    # Only Amazon credentials are used from this explicit service configuration.
    # Database, storage, Auth, and UI always target our disposable local stack.
    load_dotenv(env_file)
    report_id = None
    if report_reference:
        report_id = json.loads(report_reference.read_text(encoding="utf-8"))["reportId"]
        require(isinstance(report_id, str) and bool(report_id), "Invalid saved report reference.")
    private_output.mkdir(parents=True, mode=0o700, exist_ok=True)
    private_output.chmod(0o700)
    logging.disable(logging.CRITICAL)
    print('{"stage":"starting_disposable_stack"}', flush=True)
    with LocalSupabaseStack() as stack, PostgresDatabaseConnection(stack.database_url) as database:
        storage = SupabaseArchiveStorage(stack.api_url, stack.service_key)
        client = None
        try:
            scope = get_credential_scope(scope_name)
            client = create_reports_client(
                scope_name, load_lwa_credentials(scope.refresh_token_environment)
            )
            print(
                json.dumps(
                    {"stage": "fetching_real_inventory_report", "reuse_report": bool(report_id)}
                ),
                flush=True,
            )
            acquisition_id = download_inventory_acquisition(
                cast(InventoryReportsClient, client),
                database,
                storage,
                amazon_scope=scope_name,
                seller_namespace="real-inventory-verification",
                marketplace_id=marketplace_id,
                report_id=report_id,
            )
        finally:
            close_quietly(client)
        print('{"stage":"offline_preprocessing"}', flush=True)
        capture_id = preprocess_inventory_acquisition(database, storage, acquisition_id)
        require(
            preprocess_inventory_acquisition(database, storage, acquisition_id) == capture_id,
            "Offline replay was not idempotent.",
        )
        acquisition = load_inventory_acquisition(database, acquisition_id)
        raw = load_document_archive(storage, acquisition.document)
        prepared = prepare_inventory_report(raw, marketplace_id=marketplace_id)
        require(len(prepared.items) >= 2, "Live verification needs at least two source SKUs.")
        with database.connection() as connection, connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT * FROM private.inventory_items WHERE capture_id=%s "
                "ORDER BY source_line_number",
                (capture_id,),
            )
            rows = cursor.fetchall()
            require(len(rows) == len(prepared.items), "Preprocessing changed the saved item count.")
            for actual, expected in zip(rows, prepared.items, strict=True):
                require(
                    all(actual[key] == value for key, value in expected.items()),
                    "Database inventory differs from parsed source values.",
                )
            cursor.execute("SELECT count(*) AS count FROM private.inventory_daily_captures")
            require(cursor.fetchone()["count"] == 1, "Offline replay duplicated the daily capture.")
        accounts, member_counts = prepare_accounts(stack, database, rows)
        denied = stack.request("GET", "/rest/v1/latest_inventory_items")
        require(denied.status_code in {401, 403}, "Anonymous inventory access was not denied.")
        print('{"stage":"real_browser_login_and_inventory"}', flush=True)
        browser = verify_browser(stack, accounts, private_output)
        with database.connection() as connection:
            financial = connection.execute(
                "SELECT (SELECT count(*) FROM private.settlement_transactions) + "
                "(SELECT count(*) FROM private.data_kiosk_transactions) + "
                "(SELECT count(*) FROM public.company_payout_reports)"
            ).fetchone()
            require(financial[0] == 0, "Inventory changed financial source or payout data.")
    return {
        "recorded_at_utc": datetime.now(UTC).isoformat(),
        "source": "Real Amazon SP-API Inventory Planning report",
        "amazon_scope": scope_name,
        "marketplace_id": marketplace_id,
        "report_type": acquisition.report_type,
        "report_selection": "existing completed report" if report_id else "new report request",
        "source_rows": len(rows),
        "parser_diagnostics": len(prepared.diagnostics),
        "daily_captures": 1,
        "archive_verified_and_replayed_offline": True,
        "replay_idempotent": True,
        "all_parsed_fields_match_database": True,
        "all_rest_fields_match_database": True,
        "member_row_counts": member_counts,
        "anonymous_access_denied": True,
        "financial_data_unchanged": True,
        "browser": browser,
        "disposable_stack_removed": True,
        "scope": "Live source; synthetic ownership and Auth users only in isolated local DB. "
        "No deployment.",
    }
