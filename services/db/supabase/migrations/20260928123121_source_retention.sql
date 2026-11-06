-- Retention depends on complete payout manifests. Both pruning and pinning
-- share the same day-lock guard; observation comparison keeps its exact-content contract.
-- noqa: disable=AM04
create function private.guard_data_kiosk_retention() returns trigger language plpgsql
set search_path = '' as $$
declare target_day_id uuid; observation_rank bigint;
begin
    perform private.require_read_committed();
    select v.day_id into strict target_day_id from private.data_kiosk_preprocess_versions v where v.id = new.version_id;
    perform 1 from private.data_kiosk_days d where d.id = target_day_id for update;
    if tg_table_name = 'payout_report_data_kiosk_versions' then
        if exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = new.version_id) then
            raise exception 'Pruned evidence must be reprocessed before a payout report can reference it' using errcode = '23514';
        end if;
        return new;
    end if;
    if exists (select 1 from private.data_kiosk_days d where d.current_version_id = new.version_id)
        or exists (select 1 from private.payout_report_data_kiosk_versions p where p.version_id = new.version_id) then
        raise exception 'Current or payout-referenced evidence cannot be pruned' using errcode = '23514';
    end if;
    with observations as (
        select distinct a.id,a.root_query_created_at from private.data_kiosk_preprocess_versions v
        join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
        join private.data_kiosk_acquisitions a on a.id = b.acquisition_id where v.day_id = target_day_id
    ), ranked as (
        select id,row_number() over (order by root_query_created_at desc,id desc) as rank from observations
    ) select r.rank into observation_rank from ranked r
        join private.data_kiosk_preprocess_batches b on b.acquisition_id = r.id
        join private.data_kiosk_preprocess_versions v on v.batch_id = b.id where v.id = new.version_id;
    if observation_rank <= 3 then
        raise exception 'Latest three source observations must be retained' using errcode = '23514';
    end if;
    return new;
end;
$$;
create trigger preserve_required_evidence before insert on private.data_kiosk_pruned_versions
for each row execute function private.guard_data_kiosk_retention();

-- Reject payload loss even from trusted direct SQL, and serialize pins with
-- pruning using the same day locks. There is no independent pin/unpin API.
create trigger preserve_required_evidence
before insert on private.payout_report_data_kiosk_versions
for each row execute function private.guard_data_kiosk_retention();

create function private.prune_data_kiosk_preprocess(
    p_keep_observations integer default 3
) returns integer
language plpgsql set search_path = '' as $$
declare candidate record; removed integer := 0; removed_skus text[];
    scope_removed boolean := false;
begin
    perform private.lock_payout_report_inputs();
    perform private.require_read_committed();
    if p_keep_observations is null or p_keep_observations < 3 then
        raise exception 'Retain at least three observations' using errcode = '23514';
    end if;
    for candidate in
        with observations as (
            select distinct v.day_id,a.id,a.root_query_created_at
            from private.data_kiosk_preprocess_versions v
            join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
            join private.data_kiosk_acquisitions a on a.id = b.acquisition_id
        ), ranked as (
            select *,row_number() over (partition by day_id order by root_query_created_at desc,id desc) as observation_rank
            from observations
        )
        select v.id,v.day_id,d.seller_namespace from private.data_kiosk_preprocess_versions v
        join private.data_kiosk_days d on d.id = v.day_id
        join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
        join ranked r on r.day_id = v.day_id and r.id = b.acquisition_id
        where r.observation_rank > p_keep_observations
          and not exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = v.id)
        order by d.seller_namespace,d.marketplace_name,d.activity_date,d.dataset_key,v.id
    loop
        perform 1 from private.data_kiosk_days d where d.id = candidate.day_id for update;
        -- Recheck after waiting: another retention operation may have completed.
        if exists (select 1 from private.data_kiosk_pruned_versions p where p.version_id = candidate.id)
           or exists (select 1 from private.data_kiosk_days d where d.current_version_id = candidate.id)
           or exists (select 1 from private.payout_report_data_kiosk_versions p where p.version_id = candidate.id) then continue; end if;
        insert into private.data_kiosk_pruned_versions(version_id) values (candidate.id);
        select coalesce(array_agg(distinct t.sku) filter (where t.sku is not null),'{}'::text[])
        into removed_skus from private.data_kiosk_transactions t where t.version_id = candidate.id;
        delete from private.data_kiosk_transactions where version_id = candidate.id;
        scope_removed := scope_removed or private.payout_source_has_new_skus(
            candidate.seller_namespace,removed_skus);
        removed := removed + 1;
    end loop;
    if scope_removed then
        perform private.request_all_payout_report_refreshes();
    end if;
    return removed;
end;
$$;

-- Compare normalized complete contents, never totals alone. A missing compatible
-- result or pruned payload makes comparison unavailable, including empty days.
create function private.compare_data_kiosk_observations(p_day_id uuid, p_preprocess_version text)
returns jsonb language sql stable set search_path = '' as $$
with observations as (
    select distinct a.id,a.root_query_created_at from private.data_kiosk_preprocess_versions v
    join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
    join private.data_kiosk_acquisitions a on a.id = b.acquisition_id where v.day_id = p_day_id
    order by a.root_query_created_at desc,a.id desc limit 3
), versions as (
    select o.id as acquisition_id,v.* from observations o
    left join lateral (
        select v.* from private.data_kiosk_preprocess_versions v
        join private.data_kiosk_preprocess_batches b on b.id = v.batch_id
        where v.day_id = p_day_id and b.acquisition_id = o.id and v.preprocess_version = p_preprocess_version
        order by v.id desc limit 1
    ) v on true
), summary as (
    select
        count(*) = 3 and count(id) = 3 and not bool_or(exists (
            select 1 from private.data_kiosk_pruned_versions p where p.version_id = versions.id
        )) as available,
        count(distinct content_sha256) = 1 as matching_contents,
        coalesce(jsonb_agg(jsonb_build_object(
            'acquisition_id', acquisition_id, 'version_id', id,
            'content_sha256', content_sha256, 'row_count', row_count
        )), '[]'::jsonb) as observations
    from versions
)
select jsonb_build_object(
    'available', available,
    'equal', case when available then matching_contents else null end,
    'observations', observations
) from summary;
$$;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
