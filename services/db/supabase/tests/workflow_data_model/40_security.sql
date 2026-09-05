-- Supabase API roles have no access to direct-connection-only workflow data.

do $$
begin
    if pg_catalog.has_schema_privilege('anon', 'private', 'usage')
       or pg_catalog.has_schema_privilege('authenticated', 'private', 'usage')
       or pg_catalog.has_schema_privilege('service_role', 'private', 'usage')
    then
        raise exception 'Application roles must not use the private schema.';
    end if;

    if exists (
        select 1
        from (
            values
                ('anon'),
                ('authenticated'),
                ('service_role')
        ) as role_to_check (role_name)
        cross join pg_catalog.pg_class as relation_record
        inner join pg_catalog.pg_namespace as relation_namespace
            on relation_namespace.oid = relation_record.relnamespace
        where relation_namespace.nspname in ('public', 'private')
          and relation_record.relkind in ('r', 'p', 'v', 'm', 'f')
          and pg_catalog.has_table_privilege(
              role_to_check.role_name,
              relation_record.oid,
              'select, insert, update, delete, truncate, references, trigger'
          )
    ) then
        raise exception 'API roles received a workflow relation privilege.';
    end if;

    if exists (
        select 1
        from (
            values
                ('anon'),
                ('authenticated'),
                ('service_role')
        ) as role_to_check (role_name)
        cross join pg_catalog.pg_proc as function_record
        inner join pg_catalog.pg_namespace as function_namespace
            on function_namespace.oid = function_record.pronamespace
        where function_namespace.nspname in ('public', 'private')
          and pg_catalog.has_function_privilege(
              role_to_check.role_name,
              function_record.oid,
              'execute'
          )
    ) then
        raise exception 'API roles received a workflow function privilege.';
    end if;

    if exists (
        select 1
        from (
            values
                ('anon'),
                ('authenticated'),
                ('service_role')
        ) as role_to_check (role_name)
        cross join pg_catalog.pg_class as sequence_record
        inner join pg_catalog.pg_namespace as sequence_namespace
            on sequence_namespace.oid = sequence_record.relnamespace
        where sequence_namespace.nspname in ('public', 'private')
          and sequence_record.relkind = 'S'
          and pg_catalog.has_sequence_privilege(
              role_to_check.role_name,
              sequence_record.oid,
              'select, usage, update'
          )
    ) then
        raise exception 'API roles received a workflow sequence privilege.';
    end if;
end;
$$;
