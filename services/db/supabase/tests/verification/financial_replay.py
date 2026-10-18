"""Replay authentic locally retained seed archives in a disposable database."""

import json

from services.db.supabase.benchmarks.common import docker
from services.db.supabase.tests.integration_support import TransactionDatabase
from services.db.supabase.tests.verification.financial_seed import Connection, require
from services.sync.src.archives.storage import SupabaseArchiveStorage
from services.sync.src.data_kiosk_economics.workflow import preprocess_data_kiosk_acquisition
from services.sync.src.finances.workflow import preprocess_finances_acquisition
from services.sync.src.preprocess_version import PREPROCESS_VERSION


def current_semantic_fingerprints(connection: Connection) -> tuple[str, str]:
    """Ignore only generated row/version IDs and timestamps when comparing replayed facts."""
    finances = connection.execute(
        "select md5(string_agg(md5((to_jsonb(t)-'id'-'version_id'-'transaction_id'-'created_at')"
        "::text),'' "
        "order by s.id,t.component_key)) from private.finances_transaction_components t "
        "join private.finances_days s on s.current_version_id=t.version_id"
    ).fetchall()[0][0]
    kiosk = connection.execute(
        "select md5(string_agg(md5((to_jsonb(t)-'id'-'version_id'-'created_at')::text),'' "
        "order by d.id,t.component_key)) from private.data_kiosk_transactions t "
        "join private.data_kiosk_days d on d.current_version_id=t.version_id"
    ).fetchall()[0][0]
    return finances, kiosk


def reprocess_local_archives(connection: Connection) -> dict[str, object]:
    """Read seeded local Storage; publish new processor versions only into the disposable DB."""
    database_name = connection.execute("select current_database()").fetchall()[0][0]
    require(
        database_name.startswith("aselbox_test_"), "Archive replay requires a disposable database"
    )
    metadata = json.loads(docker("inspect", "supabase_storage_aselbox_frontend_seed"))
    environment = dict(
        value.split("=", 1) for value in metadata[0]["Config"]["Env"] if "=" in value
    )
    storage = SupabaseArchiveStorage("http://127.0.0.1:55421", environment.get("SERVICE_KEY", ""))
    database = TransactionDatabase(connection)
    before = current_semantic_fingerprints(connection)
    finances_days = connection.execute(
        "select distinct b.acquisition_id::text from private.finances_days s "
        "join private.finances_preprocess_versions v on v.id=s.current_version_id "
        "join private.finances_preprocess_batches b on b.id=v.batch_id "
        "where v.preprocess_version<>%s order by 1",
        (PREPROCESS_VERSION,),
    ).fetchall()
    for (acquisition_id,) in finances_days:
        preprocess_finances_acquisition(database, storage, acquisition_id)
    acquisitions = connection.execute(
        "select distinct b.acquisition_id::text from private.data_kiosk_days d "
        "join private.data_kiosk_preprocess_versions v on v.id=d.current_version_id "
        "join private.data_kiosk_preprocess_batches b on b.id=v.batch_id "
        "where v.preprocess_version<>%s order by 1",
        (PREPROCESS_VERSION,),
    ).fetchall()
    for (acquisition_id,) in acquisitions:
        preprocess_data_kiosk_acquisition(database, storage, acquisition_id)
    require(
        current_semantic_fingerprints(connection) == before,
        "Authentic archive replay changed a source field, amount, or category",
    )
    return {
        "preprocess_version": PREPROCESS_VERSION,
        "finances_acquisitions_replayed": len(finances_days),
        "data_kiosk_acquisitions_replayed": len(acquisitions),
        "authentic_local_archives_verified": True,
        "complete_current_fact_semantics_unchanged": True,
        "existing_storage_modified": False,
    }
