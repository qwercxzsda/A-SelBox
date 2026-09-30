"""Fetch missing historical source documents into a private local verification cache."""

from __future__ import annotations

import argparse
import base64
import json
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from uuid import uuid7

import psycopg
from dotenv import load_dotenv

from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.isolated_database import isolated_database
from services.db.supabase.tests.verification.financial_seed import (
    Connection,
    load_financial_seed,
    require,
)
from services.sync.src.amazon.client import create_data_kiosk_client
from services.sync.src.amazon.credentials import close_quietly, load_lwa_credentials
from services.sync.src.amazon.data_kiosk.document_decoding import decompress_data_kiosk_document
from services.sync.src.amazon.data_kiosk.economics_acquisition import iter_economics_document_pages
from services.sync.src.amazon.data_kiosk.models import DataKioskDocumentKind
from services.sync.src.amazon.data_kiosk.query_builder import (
    ECONOMICS_SCHEMA_NAME,
    build_daily_msku_economics_query,
)
from services.sync.src.amazon.datetimes import parse_amazon_datetime
from services.sync.src.amazon.marketplace_names import marketplace_name_from_id
from services.sync.src.amazon.marketplaces import get_credential_scope
from services.sync.src.archives.models import ArchivedDataKioskPage, DataKioskAcquisition
from services.sync.src.archives.storage import ArchiveStorage, archive_document
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.database.acquisitions import persist_data_kiosk_acquisition
from services.sync.tests.support.archives import MemoryArchiveStorage

START, END = date(2026, 6, 1), date(2026, 6, 15)


def fetch_scope(requests: list[tuple[str, str, str]], cache: Path) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for seller, scope_name, marketplace in requests:
        scope = get_credential_scope(scope_name)
        target = cache / (marketplace + ".json")
        if target.exists():
            result.append({"marketplace": marketplace_name_from_id(marketplace), "cached": True})
            continue
        client = create_data_kiosk_client(
            scope.client_marketplace, load_lwa_credentials(scope.refresh_token_environment)
        )
        try:
            query = build_daily_msku_economics_query(START, END, marketplace)
            pages = list(
                iter_economics_document_pages(
                    client,
                    query,
                    max_pages=10,
                    max_poll_attempts=30,
                    poll_interval_seconds=5,
                )
            )
            payload = {
                "seller_namespace": seller,
                "scope": scope_name,
                "marketplace_id": marketplace,
                "start_date": START.isoformat(),
                "end_date": END.isoformat(),
                "query": query,
                "downloaded_at": datetime.now(UTC).isoformat(),
                "pages": [
                    {
                        "page_number": page.page_number,
                        "query_id": page.query_id,
                        "document_kind": page.document_kind.value,
                        "is_terminal": page.is_terminal,
                        "document_id": page.document_id,
                        "document": base64.b64encode(page.document).decode()
                        if page.document is not None
                        else None,
                        "api_metadata": dict(page.api_metadata),
                    }
                    for page in pages
                ],
            }
            target.write_text(json.dumps(payload), encoding="utf-8")
            result.append(
                {
                    "marketplace": marketplace_name_from_id(marketplace),
                    "pages": len(pages),
                    "document_bytes": sum(len(page.document or b"") for page in pages),
                }
            )
            print(json.dumps(result[-1]), flush=True)
        finally:
            close_quietly(client)
    return result


def cached_acquisition(path: Path, storage: ArchiveStorage) -> DataKioskAcquisition:
    """Reconstruct a typed acquisition from exact privately cached API bytes."""
    value: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    require(
        value["start_date"] == START.isoformat() and value["end_date"] == END.isoformat(),
        "Supplementary cache has unexpected dates",
    )
    pages: list[ArchivedDataKioskPage] = []
    for item in value["pages"]:
        document = None
        if item["document"] is not None:
            decoded, compression = decompress_data_kiosk_document(
                base64.b64decode(item["document"], validate=True)
            )
            document = archive_document(storage, decoded, source_compression=compression)
        pages.append(
            ArchivedDataKioskPage(
                page_number=item["page_number"],
                query_id=item["query_id"],
                query_created_at=parse_amazon_datetime(item["api_metadata"]["createdTime"]),
                document_kind=DataKioskDocumentKind(item["document_kind"]),
                is_terminal=item["is_terminal"],
                document_id=item["document_id"],
                document=document,
                api_metadata=item["api_metadata"],
            )
        )
    root = pages[0]
    return DataKioskAcquisition(
        id=uuid7(),
        seller_namespace=value["seller_namespace"],
        amazon_scope=value["scope"],
        root_query_id=root.query_id,
        root_query_created_at=root.query_created_at,
        query_definition=value["query"],
        schema_version=ECONOMICS_SCHEMA_NAME,
        marketplace_id=value["marketplace_id"],
        query_start_date=START,
        query_end_date=END,
        downloaded_at=parse_amazon_datetime(value["downloaded_at"]),
        pages=tuple(pages),
        api_metadata=root.api_metadata,
    )


def publish_supplement(connection: Connection, cache: Path) -> dict[str, object]:
    """Use actual archive integrity, category preprocessing, and publication validators."""
    database = TransactionDatabase(connection)
    storage = MemoryArchiveStorage()
    files = sorted(cache.glob("*.json"))
    require(len(files) == 18, "The supplementary cache must contain all 18 seed marketplaces")
    rows_before = connection.execute(
        "select count(*) from private.data_kiosk_transactions"
    ).fetchall()[0][0]
    document_hashes: dict[str, list[str]] = {}
    for path in files:
        acquisition = cached_acquisition(path, storage)
        document_hashes[marketplace_name_from_id(acquisition.marketplace_id)] = [
            page.document.document_sha256 for page in acquisition.pages if page.document is not None
        ]
        acquisition_id = persist_data_kiosk_acquisition(database, acquisition)
        preprocess_data_kiosk_acquisition(database, storage, acquisition_id)
    rows_after = connection.execute(
        "select count(*) from private.data_kiosk_transactions"
    ).fetchall()[0][0]
    return {
        "start_date": START.isoformat(),
        "end_date": END.isoformat(),
        "marketplaces": len(files),
        "complete_days_added": 15 * len(files),
        "source_rows_added": rows_after - rows_before,
        "production_preprocessing_used": True,
        "remote_storage_writes": False,
        "original_database_writes": False,
        "document_sha256": document_hashes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=Path, required=True)
    parser.add_argument("--dotenv", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    args.cache.chmod(0o700)
    with isolated_database() as target, psycopg.connect(target) as connection:
        load_financial_seed(connection, args.seed)
        requests = connection.execute(
            "select distinct seller_namespace,amazon_scope,marketplace_ids[1] "
            "from private.data_kiosk_acquisitions order by 2,3"
        ).fetchall()
    load_dotenv(args.dotenv)
    groups: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for seller, scope, marketplace in requests:
        groups[scope].append((seller, scope, marketplace))
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(fetch_scope, group, args.cache) for group in groups.values()]
        results = [future.result() for future in futures]
    print(
        json.dumps(
            {
                "downloaded_marketplaces": sum(len(result) for result in results),
                "database_writes": False,
                "remote_storage_writes": False,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
