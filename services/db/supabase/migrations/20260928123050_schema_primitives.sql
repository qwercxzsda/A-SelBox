-- Fresh baseline. Successful publications are complete immutable child sets.
create schema private;
revoke all on schema private from public, anon, authenticated, service_role;
create extension if not exists btree_gist with schema extensions;

create type public.allocation_category as enum (
    'SETTLEMENT', 'SELBOX', 'DATA_KIOSK', 'ANALYSIS_ONLY'
);

-- PostgreSQL 17 has no uuidv7(). Trusted Python writers normally supply IDs.
create function private.uuid7() returns uuid language plpgsql volatile
set search_path = '' as $$
declare microseconds bigint := floor(extract(epoch from clock_timestamp()) * 1000000)::bigint;
begin
    -- RFC 9562 sub-millisecond fraction reduces random ordering within one ms.
    -- Source publications still use the monotonic Python uuid.uuid7() generator.
    return (lpad(to_hex(microseconds / 1000), 12, '0') || '7'
        || lpad(to_hex((microseconds % 1000) * 4096 / 1000), 3, '0')
        || '8' || substr(replace(gen_random_uuid()::text, '-', ''), 2, 15))::uuid;
end;
$$;
create domain public.local_uuid as uuid
check (
    substring(value::text from 15 for 1) = '7'
    and substring(value::text from 20 for 1) in ('8', '9', 'a', 'b')
);
create domain private.nonblank as text check (length(btrim(value)) > 0);
create domain private.sha256 as text check (value ~ '^[0-9a-f]{64}$');
create domain private.exact_numeric as numeric
check (
    value::text not in ('NaN', 'Infinity', '-Infinity')
    and greatest(length(ltrim(split_part(abs(value)::text, '.', 1), '0')) + scale(value), 1) <= 1000
);

create function private.reject_mutation() returns trigger language plpgsql
set search_path = '' as $$
begin
    raise exception '% is immutable', tg_table_name using errcode = '23514';
end;
$$;
