"""Current read-RPC signature and permission contract assertions."""

from services.db.supabase.tests.local_database import require_row
from services.db.supabase.tests.source_fixtures import SourceModelFixture


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
