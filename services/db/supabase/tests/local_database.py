"""Shared safeguards for database tests that must run against local Supabase."""

from pathlib import Path
from typing import LiteralString, cast
from urllib.parse import urlsplit

import psycopg
from psycopg import sql

from services.sync.src.database.config import LOCAL_SUPABASE_URL
from services.sync.src.database.local_postgres import validate_local_postgres_database_url

DEFAULT_DATABASE_URL = LOCAL_SUPABASE_URL
LOCAL_SUPABASE_PORT = urlsplit(LOCAL_SUPABASE_URL).port
LATEST_REQUIRED_MIGRATION = "20260905080405"


class UnsafeDatabaseUrlError(ValueError):
    """Raised when a database URL is not the repository's local Supabase DB."""


def require_local_supabase_url(database_url: str) -> None:
    """Reject every target except local Supabase Postgres on its configured port."""
    try:
        validate_local_postgres_database_url(database_url)
    except ValueError as error:
        raise UnsafeDatabaseUrlError(
            "Database tests require a valid local Supabase Postgres URL."
        ) from error
    if urlsplit(database_url).port != LOCAL_SUPABASE_PORT:
        raise UnsafeDatabaseUrlError(
            "Database tests are restricted to local Supabase Postgres on port 54322."
        )


def assert_migrated_local_schema(
    connection: psycopg.Connection[tuple[object, ...]],
) -> None:
    """Confirm the loopback server is the migrated Supabase project under test."""
    result = connection.execute(
        """
        select
            to_regnamespace('auth') is not null,
            to_regnamespace('supabase_migrations') is not null,
            to_regclass('private.settlement_reports') is not null,
            to_regclass('supabase_migrations.schema_migrations') is not null
        """
    ).fetchone()
    if result != (True, True, True, True):
        raise UnsafeDatabaseUrlError(
            "The local database is not the expected migrated Supabase project."
        )

    current_schema = connection.execute(
        """
        with expected_table (relation_name) as (
            values
                ('public.companies'),
                ('public.company_sku_fee_rates'),
                ('private.settlement_reports'),
                ('private.settlement_report_rows'),
                ('private.settlement_processing_logs'),
                ('private.settlement_processed_reports'),
                ('private.settlement_processed_entries'),
                ('private.settlement_processed_results'),
                ('private.data_kiosk_provision_processing_logs'),
                ('private.data_kiosk_provisions')
        )
        select
            exists (
                select 1
                from supabase_migrations.schema_migrations
                where version = %(required_version)s
            ),
            not exists (
                select expected_table.relation_name
                from expected_table
                where to_regclass(expected_table.relation_name) is null
            ),
            to_regclass('private.latest_settlement_processing_logs') is not null
            and to_regclass('private.latest_settlement_processed_results') is not null
            and to_regclass('private.latest_data_kiosk_provision_processing_logs') is not null
            and to_regclass('private.latest_data_kiosk_provisions') is not null
            and to_regclass('private.latest_company_sku_fee_rates') is not null
            and to_regprocedure(
                'private.prune_data_kiosk_provision_results(text,text,integer)'
            ) is not null,
            not exists (
                select
                    table_schema.nspname || '.' || table_record.relname
                from pg_catalog.pg_class as table_record
                inner join pg_catalog.pg_namespace as table_schema
                    on table_schema.oid = table_record.relnamespace
                where table_schema.nspname in ('public', 'private')
                  and table_record.relkind in ('r', 'p')
                except
                select expected_table.relation_name
                from expected_table
            ),
            (
                select count(*) = 4
                from pg_catalog.pg_constraint as constraint_record
                where constraint_record.conrelid = any(array[
                    'private.settlement_report_rows'::regclass,
                    'private.settlement_processed_entries'::regclass,
                    'private.settlement_processed_results'::regclass
                ])
                  and constraint_record.contype = 'f'
                  and constraint_record.confrelid in (
                      'private.settlement_reports'::regclass,
                      'private.settlement_report_rows'::regclass,
                      'private.settlement_processing_logs'::regclass
                  )
            ),
            not exists (
                select expected_table.relation_name
                from expected_table
                inner join pg_catalog.pg_class as table_record
                    on table_record.oid
                    = expected_table.relation_name::regclass
                where not table_record.relrowsecurity
            ),
            not pg_catalog.has_schema_privilege('anon', 'private', 'usage')
            and not pg_catalog.has_schema_privilege(
                'authenticated',
                'private',
                'usage'
            )
            and not pg_catalog.has_schema_privilege(
                'service_role',
                'private',
                'usage'
            )
            and not exists (
                select 1
                from (
                    values
                        ('anon', 'public.companies'),
                        ('authenticated', 'public.companies'),
                        ('service_role', 'public.companies'),
                        ('anon', 'public.company_sku_fee_rates'),
                        ('authenticated', 'public.company_sku_fee_rates'),
                        ('anon', 'private.settlement_reports'),
                        ('authenticated', 'private.settlement_reports'),
                        ('anon', 'private.data_kiosk_provisions'),
                        ('authenticated', 'private.data_kiosk_provisions'),
                        ('service_role', 'private.data_kiosk_provisions'),
                        ('anon', 'private.data_kiosk_provision_processing_logs'),
                        ('authenticated', 'private.data_kiosk_provision_processing_logs'),
                        ('service_role', 'private.data_kiosk_provision_processing_logs')
                ) as access_check (role_name, relation_name)
                where pg_catalog.has_table_privilege(
                    access_check.role_name,
                    access_check.relation_name,
                    'select, insert, update, delete'
                )
            )
        """,
        {"required_version": LATEST_REQUIRED_MIGRATION},
    ).fetchone()
    if current_schema != (True,) * 7:
        raise UnsafeDatabaseUrlError(
            "The local database is not migrated to the required schema version."
        )


def read_trusted_sql(path: Path) -> sql.SQL:
    """Load a repository-owned SQL file as one psycopg composable statement."""
    return sql.SQL(cast(LiteralString, path.read_text(encoding="utf-8")))
