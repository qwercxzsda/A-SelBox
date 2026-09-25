"""Local-only credentials, connections and sanitized benchmark fingerprints."""

# Subprocess arguments use fixed local resources; credentials never leave memory.
# ruff: noqa: S603, S607
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, BinaryIO, LiteralString

import psycopg

REPO = Path(__file__).resolve().parents[4]
CONTAINER = "supabase_db_aselbox_frontend_seed"
REST_CONTAINER = "supabase_rest_aselbox_frontend_seed"
PORT = 55422
DATABASES = {"aselbox_opt_large", "aselbox_opt_broad"}
Connection = psycopg.Connection[tuple[Any, ...]]


def docker(*arguments: str, stdin: BinaryIO | None = None, input: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["docker", *arguments], stdin=stdin, input=input, capture_output=True, check=False
    )
    if result.returncode:
        raise RuntimeError("Local Docker operation failed: " + arguments[0])
    return result.stdout


def local_password() -> str:
    if password := os.environ.get("PGPASSWORD"):
        return password
    metadata = json.loads(docker("inspect", CONTAINER))
    environment = dict(
        value.split("=", 1) for value in metadata[0]["Config"]["Env"] if "=" in value
    )
    password = environment.get("POSTGRES_PASSWORD")
    if not password:
        raise RuntimeError("Local Docker database has no configured password")
    return str(password)


def connect(database: str, password: str) -> Connection:
    if database not in DATABASES:
        raise ValueError("Only allowlisted disposable benchmark databases are accepted")
    return _connect(database, password)


def source_connection(password: str) -> Connection:
    """Source access is limited by callers to catalog reads, dumps and clone lifecycle."""
    return _connect("postgres", password)


def _connect(database: str, password: str) -> Connection:
    return psycopg.connect(
        host="127.0.0.1",
        hostaddr="127.0.0.1",
        port=PORT,
        user="postgres",
        password=password,
        dbname=database,
        autocommit=True,
        prepare_threshold=None,
    )


def psql(database: str, statement: str, *, role: str = "postgres") -> str:
    if database not in DATABASES or role not in {"postgres", "supabase_admin"}:
        raise ValueError("SQL fixture execution requires an allowlisted local clone")
    return (
        docker(
            "exec",
            "-i",
            CONTAINER,
            "psql",
            "-U",
            role,
            "-d",
            database,
            "-X",
            "-A",
            "-t",
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
            input=statement.encode(),
        )
        .decode()
        .strip()
    )


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def synthetic_token(secret: str, user: str) -> str:
    """Sign only benchmark-local claims; never authenticate against real Auth."""

    def encode(value: object) -> str:
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    unsigned = (
        encode({"alg": "HS256", "typ": "JWT"})
        + "."
        + encode({"sub": user, "role": "authenticated", "exp": int(time.time()) + 3600})
    )
    signature = hmac.new(secret.encode(), unsigned.encode(), hashlib.sha256).digest()
    return unsigned + "." + base64.urlsafe_b64encode(signature).decode().rstrip("=")


CATALOG_QUERIES: dict[str, LiteralString] = {
    "tables_views_security": """
        select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,
               c.relacl::text,pg_get_userbyid(c.relowner),
               case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) end
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S')
        order by 1,2
    """,
    "columns": """
        select n.nspname,c.relname,a.attname,a.attnum,
               format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attacl::text,
               pg_get_expr(d.adbin,d.adrelid)
        from pg_attribute a join pg_class c on c.oid=a.attrelid
        join pg_namespace n on n.oid=c.relnamespace
        left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
        where n.nspname in ('public','private') and c.relkind in ('r','p','v','m')
          and a.attnum>0 and not a.attisdropped order by 1,2,4
    """,
    "constraints": """
        select n.nspname,c.conname,c.conrelid::regclass::text,c.contype,
               pg_get_constraintdef(c.oid,true)
        from pg_constraint c join pg_namespace n on n.oid=c.connamespace
        where n.nspname in ('public','private') order by 1,2,3
    """,
    "indexes": """
        select n.nspname,t.relname,i.relname,pg_get_indexdef(i.oid),
               x.indisvalid,x.indisready,x.indislive
        from pg_index x join pg_class i on i.oid=x.indexrelid
        join pg_class t on t.oid=x.indrelid join pg_namespace n on n.oid=t.relnamespace
        where n.nspname in ('public','private') order by 1,2,3
    """,
    "functions": """
        select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),
               pg_get_functiondef(p.oid),p.proacl::text,pg_get_userbyid(p.proowner)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in ('public','private') and p.prokind in ('f','p') order by 1,2,3
    """,
    "policies": """
        select schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check
        from pg_policies where schemaname in ('public','private') order by 1,2,3
    """,
    "triggers": """
        select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)
        from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','private') and not t.tgisinternal order by 1,2,3
    """,
    "types_and_schemas": """
        select n.nspname,t.typname,t.typtype,format_type(t.typbasetype,t.typtypmod),
               t.typnotnull,t.typdefault,t.typacl::text,n.nspacl::text,
               (select array_agg(e.enumlabel order by e.enumsortorder)
                from pg_enum e where e.enumtypid=t.oid)
        from pg_type t join pg_namespace n on n.oid=t.typnamespace
        where n.nspname in ('public','private') and t.typtype in ('d','e') order by 1,2
    """,
}


def catalog_fingerprint(connection: psycopg.Connection[Any]) -> dict[str, str]:
    return {
        "format": "2-includes-view-options-and-index-state",
        **{
            name: digest(connection.execute(sql).fetchall())
            for name, sql in CATALOG_QUERIES.items()
        },
    }


def identities(connection: Connection) -> dict[str, str]:
    rows = connection.execute(
        "select user_id::text,access_role::text "
        "from public.app_accounts order by access_role,user_id"
    ).fetchall()
    members = [str(user) for user, role in rows if role == "company_member"]
    operators = [str(user) for user, role in rows if role == "operator"]
    if not members or not operators:
        raise RuntimeError("Benchmark needs an existing member and operator account")
    return {"member_a": members[0], "operator": operators[0]}
