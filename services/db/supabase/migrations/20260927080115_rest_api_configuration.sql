-- General REST aggregation stays disabled; dedicated RPCs serve summaries and options.
alter role authenticator set "pgrst.db_aggregates_enabled" = 'false';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
