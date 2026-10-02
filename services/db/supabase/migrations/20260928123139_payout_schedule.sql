-- Supabase installs pg_cron in its configured database, normally postgres.
-- Auxiliary databases in the same cluster still install the portable worker;
-- they cannot own another pg_cron extension or automatically register this job.
do $$
begin
    if current_database() is distinct from current_setting('cron.database_name', true) then
        raise notice 'Payout scheduling requires the configured pg_cron database; worker installed without a schedule in %', current_database();
        return;
    end if;
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
        'company-payout-reports',
        '*/5 * * * *',
        'set lock_timeout = ''5s''; select private.refresh_company_payout_reports(10);'
    );
end;
$$;
