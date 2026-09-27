-- A complete financial request declares all required canonical settlements and
-- marketplace-local days. Missing or incompatible inputs raise, never disappear
-- through filtering, RLS, NULL SUM behavior, or implicit source substitution.
create function private.assert_company_source_scope(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_settlement_ids uuid[],
    p_marketplaces text[],
    p_dataset_key text default 'economics'
) returns void
language plpgsql stable set search_path = '' as $$
begin
    if nullif(btrim(p_seller_namespace),'') is null or nullif(btrim(p_preprocess_version),'') is null
        or p_start is null or p_end is null or p_end < p_start
        or p_settlement_ids is null or p_marketplaces is null
        or p_dataset_key is distinct from 'economics'
        or array_position(p_settlement_ids,null) is not null or array_position(p_marketplaces,null) is not null
        or not (p_marketplaces <@ array[
            'Amazon.com', 'Amazon.ca', 'Amazon.com.mx', 'Amazon.com.br', 'Amazon.co.uk',
            'Amazon.de', 'Amazon.fr', 'Amazon.it', 'Amazon.es', 'Amazon.nl',
            'Amazon.se', 'Amazon.pl', 'Amazon.com.be', 'Amazon.ie', 'Amazon.com.tr',
            'Amazon.ae', 'Amazon.sa', 'Amazon.eg', 'Amazon.in', 'Amazon.co.za',
            'Amazon.co.jp', 'Amazon.com.au', 'Amazon.sg', 'Non-Amazon US'
        ]::text[]) then
        raise exception 'Explicit valid financial input scope required' using errcode = '23514';
    end if;
    if exists (
        select 1 from unnest(p_settlement_ids) requested(id)
        left join private.settlements s on s.id = requested.id and s.seller_namespace = p_seller_namespace
        left join private.settlement_preprocess_versions v on v.id = s.current_version_id
        where v.id is null or v.preprocess_version <> p_preprocess_version
    ) then raise exception 'Missing or incompatible required Settlement version' using errcode = '23514'; end if;
    if exists (
        select 1 from unnest(p_marketplaces) m(name)
        cross join generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') date_scope(day)
        left join private.data_kiosk_days d on d.seller_namespace = p_seller_namespace
            and d.marketplace_name = m.name and d.activity_date = date_scope.day::date and d.dataset_key = p_dataset_key
        left join private.data_kiosk_preprocess_versions v on v.id = d.current_version_id
        where v.id is null or v.preprocess_version <> p_preprocess_version
           or exists (select 1 from private.data_kiosk_pruned_versions pruned where pruned.version_id = v.id)
    ) then raise exception 'Missing or incompatible required Data Kiosk day coverage' using errcode = '23514'; end if;
end;
$$;

create function private.company_financial_totals(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_settlement_ids uuid[], p_marketplaces text[],
    p_dataset_key text default 'economics'
) returns table (
    company_id uuid,
    currency text,
    source_amount numeric,
    fee_amount numeric,
    company_amount numeric
)
language plpgsql stable set search_path = '' as $$
begin
    perform private.assert_company_source_scope(p_seller_namespace,p_start,p_end,p_preprocess_version,
        p_settlement_ids,p_marketplaces,p_dataset_key);
    if exists (
        select 1 from public.live_company_components c
        where c.seller_namespace = p_seller_namespace and c.activity_date between p_start and p_end
          and ((c.source = 'SETTLEMENT' and c.source_identity_id = any(p_settlement_ids))
            or (c.source = 'DATA_KIOSK' and c.marketplace_name = any(p_marketplaces)
                and c.category = 'DATA_KIOSK'))
          and c.resolution_status not in ('APPLIED','NOT_APPLICABLE')
    ) then raise exception 'Unresolved ownership or fee coverage' using errcode = '23514'; end if;
    return query select c.company_id::uuid,c.currency,sum(c.source_amount),sum(c.fee_amount),sum(c.company_amount)
        from public.live_company_components c
        where c.seller_namespace = p_seller_namespace and c.activity_date between p_start and p_end
          and ((c.source = 'SETTLEMENT' and c.source_identity_id = any(p_settlement_ids))
            or (c.source = 'DATA_KIOSK' and c.marketplace_name = any(p_marketplaces) and c.authoritative))
        group by c.company_id,c.currency;
end;
$$;

-- Partial live summaries tolerate missing fee coverage only. They never invent
-- zero for an absent sum and never hide missing ownership or source coverage.
create function private.company_financial_progress(
    p_seller_namespace text, p_start date, p_end date, p_preprocess_version text,
    p_settlement_ids uuid[], p_marketplaces text[],
    p_dataset_key text default 'economics'
) returns table (
    company_id uuid, currency text, source_amount numeric, known_fee_amount numeric,
    known_company_amount numeric, missing_fee_count bigint, missing_fee_components jsonb
)
language plpgsql stable set search_path = '' as $$
begin
    perform private.assert_company_source_scope(p_seller_namespace,p_start,p_end,p_preprocess_version,
        p_settlement_ids,p_marketplaces,p_dataset_key);
    if exists (
        select 1 from public.live_company_components c
        where c.seller_namespace = p_seller_namespace and c.activity_date between p_start and p_end
          and ((c.source = 'SETTLEMENT' and c.source_identity_id = any(p_settlement_ids))
            or (c.source = 'DATA_KIOSK' and c.marketplace_name = any(p_marketplaces) and c.authoritative))
          and c.resolution_status = 'MISSING_OWNERSHIP'
    ) then raise exception 'Unresolved ownership' using errcode = '23514'; end if;
    return query
    select c.company_id,c.currency,sum(c.source_amount),sum(c.fee_amount),sum(c.company_amount),
        count(*) filter (where c.resolution_status = 'MISSING_FEE'),
        coalesce(jsonb_agg(
            (to_jsonb(c) - array['source_amount','quantity','fee_base','fee_rate_percent','fee_amount','company_amount'])
            || jsonb_build_object('source_amount',c.source_amount::text,'quantity',c.quantity::text,
                'fee_base',c.fee_base::text,'fee_rate_percent',c.fee_rate_percent::text,
                'fee_amount',c.fee_amount::text,'company_amount',c.company_amount::text)
            order by c.source,c.source_row_id
        ) filter (where c.resolution_status = 'MISSING_FEE'),'[]'::jsonb)
    from public.live_company_components c
    where c.seller_namespace = p_seller_namespace and c.activity_date between p_start and p_end
      and ((c.source = 'SETTLEMENT' and c.source_identity_id = any(p_settlement_ids))
        or (c.source = 'DATA_KIOSK' and c.marketplace_name = any(p_marketplaces) and c.authoritative))
    group by c.company_id,c.currency;
end;
$$;
