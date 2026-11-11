-- Keep expensive aggregation behind date-bounded, explicitly authorized RPCs.
-- Pre-aggregate compatible facts before current fee lookup; numeric arithmetic
-- remains exact and groups with missing ownership/rates preserve SQL NULL sums.
create function public.transaction_totals(
    p_date_from date default null,
    p_date_to date default null,
    p_company_ids uuid[] default null,
    p_skus text[] default null,
    p_marketplaces text[] default null,
    p_currency text default null,
    p_group_by_type boolean default false,
    p_limit integer default 1000,
    p_offset bigint default 0
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare
    finances_policy_is_sufficient boolean;
    kiosk_policy_is_sufficient boolean;
begin
    perform private.validate_transaction_filters(
        p_date_from, p_date_to, p_company_ids, p_skus, p_marketplaces,
        p_require_date => true
    );
    if p_currency is not null and p_currency !~ '^[A-Z]{3}$' then
        raise exception 'Currency must be a three-letter uppercase code' using errcode = '22023';
    end if;
    if p_group_by_type is null then
        raise exception 'Grouping preference is required' using errcode = '22023';
    end if;
    perform private.validate_page_bounds(p_limit, p_offset);
    -- The unchanged fact RLS already requires current versions for members.
    -- Administrators, owners, and bypass contexts still use the explicit pointer check.
    finances_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.finances_transaction_components'::regclass
    );
    kiosk_policy_is_sufficient := private.member_policy_covers_current_version(
        'private.data_kiosk_day_components'::regclass
    );
    return (
        with facts as (
            select t.sku, t.marketplace_name,
                t.posted_date as activity_date, t.currency,
                case when p_group_by_type then t.component_type::text end as component_type,
                t.amount::numeric as reported_amount,
                t.fee_base::numeric as fee_base
            from private.finances_activity_components as t
            where t.category = 'FINANCES'
                and (finances_policy_is_sufficient or t.is_current)
                and (p_date_from is null or t.posted_at >= p_date_from::timestamp at time zone 'UTC')
                and (p_date_to is null or t.posted_at < (p_date_to + 1)::timestamp at time zone 'UTC')
                and (coalesce(cardinality(p_company_ids), 0) = 0 or exists (
                    select 1 from public.company_skus as o
                    where o.sku = t.sku
                        and o.company_id = any(p_company_ids)
                ))
                and (coalesce(cardinality(p_skus), 0) = 0
                    or t.sku = any(p_skus))
                and (coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces))
                and (p_currency is null or t.currency = p_currency)
            union all
            select t.sku, t.marketplace_name, t.activity_date, t.currency,
                case when p_group_by_type then t.component_type::text end,
                t.amount::numeric, t.fee_base::numeric
            from private.data_kiosk_component_details as t
            where t.category = 'DATA_KIOSK'
                and (kiosk_policy_is_sufficient or exists (
                    select 1 from private.data_kiosk_days as h where h.current_version_id = t.version_id
                ))
                and (p_date_from is null or t.activity_at >= p_date_from::timestamp at time zone 'UTC')
                and (p_date_to is null or t.activity_at < (p_date_to + 1)::timestamp at time zone 'UTC')
                and (coalesce(cardinality(p_company_ids), 0) = 0 or exists (
                    select 1 from public.company_skus as o
                    where o.sku = t.sku
                        and o.company_id = any(p_company_ids)
                ))
                and (coalesce(cardinality(p_skus), 0) = 0
                    or t.sku = any(p_skus))
                and (coalesce(cardinality(p_marketplaces), 0) = 0
                    or t.marketplace_name = any(p_marketplaces))
                and (p_currency is null or t.currency = p_currency)
        ),
        fact_groups as materialized (
            select f.sku, f.marketplace_name, f.activity_date,
                f.currency, f.component_type, f.fee_base is not null as fee_applicable,
                sum(f.reported_amount) as reported_amount, sum(f.fee_base) as fee_base,
                count(*)::numeric as row_count
            from facts as f
            group by f.sku, f.marketplace_name, f.activity_date,
                f.currency, f.component_type, f.fee_base is not null
        ),
        selected_terms as materialized (
            select sku, terms_version_id, company_id
            from private.current_sku_terms as terms
            where exists (
                select 1 from fact_groups as selected
                where selected.sku = terms.sku
            )
        ),
        calculated as (
            select case when not p_group_by_type then g.marketplace_name end as marketplace_name,
                g.currency, g.component_type, g.reported_amount, g.row_count,
                case when o.company_id is null then null
                    when not g.fee_applicable then 0::numeric
                    when p.id is not null
                        then private.calculate_service_fee(g.fee_base, p.fee_rate_percent)
                end as service_fee
            from fact_groups as g
            left join selected_terms as o
                on g.sku = o.sku
            left join public.sku_fee_periods as p
                on o.terms_version_id = p.terms_version_id
                    and g.marketplace_name = p.marketplace_name
                    and p.valid_period @> g.activity_date
                    and g.fee_applicable and o.company_id is not null
        ),
        totals as (
            select c.marketplace_name, c.currency, c.component_type,
                sum(c.reported_amount) as reported_amount,
                sum(c.service_fee) as service_fee,
                sum(c.reported_amount + c.service_fee) as company_amount,
                sum(c.row_count) as row_count,
                sum(case when c.service_fee is not null then c.row_count else 0 end)
                    as known_company_count
            from calculated as c
            group by c.marketplace_name, c.currency, c.component_type
        ),
        selected as materialized (
            select t.* from totals as t
            order by t.marketplace_name collate "C" nulls first,
                t.currency collate "C", t.component_type collate "C" nulls first
            limit p_limit + 1 offset p_offset
        ),
        page as (
            select s.* from selected as s
            order by s.marketplace_name collate "C" nulls first,
                s.currency collate "C", s.component_type collate "C" nulls first
            limit p_limit
        )
        select jsonb_build_object(
            'rows', coalesce((select jsonb_agg(jsonb_build_object(
                'marketplace_name', p.marketplace_name,
                'currency', p.currency, 'component_type', p.component_type,
                'reported_amount', p.reported_amount::text, 'service_fee', p.service_fee::text,
                'company_amount', p.company_amount::text, 'row_count', p.row_count::text,
                'known_company_count', p.known_company_count::text
            ) order by p.marketplace_name collate "C" nulls first,
                p.currency collate "C", p.component_type collate "C" nulls first)
                from page as p), '[]'::jsonb),
            'next_offset', case when (select count(*) from selected) > p_limit
                then p_offset + p_limit end
        )
    );
end;
$$;
revoke all on function public.transaction_totals(
    date, date, uuid[], text[], text[], text, boolean, integer, bigint
) from public, anon, authenticated, service_role;

-- Derived records use saved inputs and report authorization. Numeric/boolean
-- fields are text in JSON, matching the application's exact-value row contract.
create function public.payout_report_records(
    p_report_id uuid, p_authoritative boolean default true,
    p_limit integer default 50, p_offset bigint default 0, p_types text[] default null
) returns jsonb language plpgsql stable security invoker set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
begin
    if p_report_id is null or p_authoritative is null then
        raise exception 'Report and record scope are required' using errcode='22023';
    end if;
    if not p_authoritative and not private.financial_account_visible() then
        raise exception 'Administrator access required' using errcode='42501';
    end if;
    perform private.validate_page_bounds(p_limit,p_offset);
    perform private.validate_transaction_filters(null,null,null,null,null,null,p_types);
    return (
        with records as materialized (
            select r.* from private.read_payout_report_records(p_report_id) r
            where r.authoritative=p_authoritative
                and (coalesce(cardinality(p_types),0)=0 or r.component_type=any(p_types))
        ), page as (
            select * from records
            order by activity_date desc,source desc,source_row_id desc
            limit p_limit offset p_offset
        )
        select jsonb_build_object(
            'rows',coalesce((select jsonb_agg(
                (select jsonb_object_agg(key,value) from jsonb_each_text(to_jsonb(p)))
                order by p.activity_date desc,p.source desc,p.source_row_id desc)
                from page p),'[]'::jsonb),
            'total_count',(select count(*)::text from records))
    );
end;
$$;

-- Grand totals remain the saved report values. Type breakdowns are derived from
-- the same immutable inputs; neither path uses current ownership or source pointers.
create function public.payout_report_totals(
    p_report_id uuid,
    p_group_by_type boolean default false,
    p_limit integer default 1000,
    p_offset bigint default 0
) returns jsonb
language plpgsql stable security invoker set search_path = ''
set plan_cache_mode = 'force_custom_plan' as $$
declare report public.company_payout_reports;
begin
    if p_report_id is null or p_group_by_type is null then
        raise exception 'Report and grouping preference are required' using errcode = '22023';
    end if;
    perform private.validate_page_bounds(p_limit,p_offset);
    select * into report from public.company_payout_reports r where r.id=p_report_id;
    if not found then raise exception 'Report access required' using errcode='42501'; end if;
    return (
        with totals as (
            select report.currency,
                case when p_group_by_type then c.component_type::text end as component_type,
                (case when p_group_by_type then sum(c.source_amount) else report.source_amount end)::text as reported_amount,
                (case when p_group_by_type then sum(c.fee_amount) else report.fee_amount end)::text as service_fee,
                (case when p_group_by_type then sum(c.company_amount) else report.company_amount end)::text as company_amount,
                count(*)::text as row_count,
                count(c.company_amount)::text as known_company_count
            from private.read_payout_report_records(p_report_id) c
            where c.authoritative
            group by case when p_group_by_type then c.component_type::text end
        ), selected as materialized (
            select * from totals
            order by currency collate "C",component_type collate "C" nulls first
            limit p_limit + 1 offset p_offset
        ), page as (
            select * from selected
            order by currency collate "C",component_type collate "C" nulls first limit p_limit
        )
        select jsonb_build_object(
            'rows',coalesce((select jsonb_agg(to_jsonb(page)
                order by currency collate "C",component_type collate "C" nulls first) from page),'[]'::jsonb),
            'next_offset',case when (select count(*) from selected) > p_limit then p_offset + p_limit end
        )
    );
end;
$$;
revoke all on function public.payout_report_records(uuid, boolean, integer, bigint, text[]),
public.payout_report_totals(uuid, boolean, integer, bigint)
from public, anon, authenticated, service_role;
