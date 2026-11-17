"""Current read-RPC signature and permission contract assertions."""

from psycopg import Connection

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture


def read_rpc_execution_settings(connection: Connection[tuple[object, ...]]) -> tuple[object, ...]:
    """Capture planner preferences and inherited resource limits for restoration checks."""
    return require_row(
        connection.execute(
            "select current_setting('plan_cache_mode'),current_setting('enable_sort'),"
            "current_setting('enable_presorted_aggregate'),current_setting('work_mem'),"
            "current_setting('hash_mem_multiplier'),current_setting('jit')"
        ).fetchone()
    )


def assert_rpc_security(fixture: SourceModelFixture, signature: str) -> None:
    """Only the current RPC signature exists, with the intended invocation grants."""
    schema, name = signature.split("(", 1)[0].split(".", 1)
    fixture.assertEqual(
        fixture.connection.execute(
            "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname=%s and p.proname=%s",
            (schema, name),
        ).fetchone(),
        (1,),
        "Each read RPC must have one unambiguous signature.",
    )
    row = fixture.connection.execute(
        "select p.prosecdef, p.provolatile::text, p.proconfig, "
        "has_function_privilege('authenticated',p.oid,'EXECUTE'), "
        "has_function_privilege('anon',p.oid,'EXECUTE'), "
        "has_function_privilege('service_role',p.oid,'EXECUTE'), "
        "exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a "
        "where a.grantee=0 and a.privilege_type='EXECUTE') "
        "from pg_proc p where p.oid=%s::regprocedure",
        (signature,),
    ).fetchone()
    row = require_row(row)
    fixture.assertEqual(row[:2], (False, "s"))
    fixture.assertIn('search_path=""', row[2])
    fixture.assertIn("plan_cache_mode=force_custom_plan", row[2])
    fixture.assertEqual(row[3:], (True, False, False, False))


def assert_rpc_contract(
    fixture: SourceModelFixture, name: str, parameter_types: dict[str, str]
) -> None:
    assert_rpc_security(fixture, f"public.{name}({','.join(parameter_types.values())})")
