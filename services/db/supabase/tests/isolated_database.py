"""Disposable local PostgreSQL database for real multi-connection checks."""

from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid7

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo

from services.db.supabase.tests.local_database import (
    DEFAULT_DATABASE_URL,
    read_trusted_sql,
    require_local_supabase_url,
)


@contextmanager
def isolated_database(database_url: str = DEFAULT_DATABASE_URL) -> Generator[str]:
    """Create and always drop an empty DB on the guarded local test server.

    Minimal auth/storage interfaces allow the actual application migrations to
    run on PostgreSQL 17 without copying existing development source evidence.
    """
    require_local_supabase_url(database_url)
    # libpq's PGHOSTADDR can otherwise override an explicit, validated URL host.
    host = urlsplit(database_url).hostname
    database_url = make_conninfo(
        database_url, hostaddr="127.0.0.1" if host == "localhost" else host
    )
    database_name = "aselbox_test_" + uuid7().hex
    connection_info = make_conninfo(database_url, dbname=database_name)
    with psycopg.connect(database_url, autocommit=True) as admin:
        admin.execute(
            sql.SQL("create database {} template template0").format(sql.Identifier(database_name))
        )
        try:
            with psycopg.connect(connection_info) as connection:
                connection.execute(
                    """
                    create schema extensions;
                    create schema auth;
                    create table auth.users(id uuid primary key);
                    create function auth.uid() returns uuid language sql stable
                    set search_path = '' as $$
                        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
                    $$;
                    grant usage on schema auth to authenticated;
                    create schema storage;
                    create table storage.buckets(
                        id text primary key,name text not null,public boolean not null
                    );
                    """
                )
                for path in sorted((Path(__file__).parents[1] / "migrations").glob("*.sql")):
                    connection.execute(read_trusted_sql(path))
            yield connection_info
        finally:
            admin.execute(
                sql.SQL("drop database {} with (force)").format(sql.Identifier(database_name))
            )
