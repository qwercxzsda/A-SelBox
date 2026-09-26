"""Build a multi-year read workload in the explicitly allowlisted disposable clone.

This is synthetic read-load data, not replayable Amazon evidence: typed dates and
source identities are shifted while raw JSON/archive references retain seed data.
Existing companies, Auth accounts, seller/SKU identities, original source rows and
payout inputs remain intact. No durable schema, indexes, functions or grants change.

``copies`` is the total number of temporal cohorts, including the original seed.
Whole-day offsets avoid February 29 collisions; each stride is at least 366 days
and exceeds the seed's date span. The seed's seasonal gaps are deliberately kept.
"""

from __future__ import annotations

import time
from typing import cast

import psycopg
from psycopg import sql
from psycopg.pq import TransactionStatus

from .common import catalog_fingerprint, digest

Connection = psycopg.Connection[tuple[object, ...]]
DATABASE = "aselbox_opt_broad"
PORT = 55422

# All cloned primary/FK identities are allocated before any inserts. Cyclic
# current-version FKs are checked explicitly after transaction-local setup mode.
SOURCE_TABLES: dict[str, dict[str, str]] = {
    "private.settlement_acquisitions": {},
    "private.settlements": {"current_version_id": "private.settlement_preprocess_versions"},
    "private.settlement_preprocess_versions": {
        "settlement_id": "private.settlements",
        "acquisition_id": "private.settlement_acquisitions",
    },
    "private.data_kiosk_acquisitions": {},
    "private.data_kiosk_days": {"current_version_id": "private.data_kiosk_preprocess_versions"},
    "private.data_kiosk_preprocess_batches": {"acquisition_id": "private.data_kiosk_acquisitions"},
    "private.data_kiosk_preprocess_versions": {
        "day_id": "private.data_kiosk_days",
        "batch_id": "private.data_kiosk_preprocess_batches",
    },
}
FACT_TABLES = {
    "private.settlement_transactions": "private.settlement_preprocess_versions",
    "private.data_kiosk_transactions": "private.data_kiosk_preprocess_versions",
}
PAYOUT_TABLES = (
    "public.company_payout_reports",
    "public.company_payout_report_components",
    "private.payout_report_settlement_versions",
    "private.payout_report_data_kiosk_versions",
    "private.payout_report_terms_versions",
)


def _identifier(relation: str) -> sql.Identifier:
    return sql.Identifier(*relation.split("."))


def _columns(connection: Connection, relation: str) -> list[tuple[str, bool, bool]]:
    rows = connection.execute(
        "select attname,atttypid='date'::regtype,"
        "atttypid in ('timestamp'::regtype,'timestamptz'::regtype) "
        "from pg_attribute where attrelid=%s::regclass and attnum>0 and not attisdropped "
        "order by attnum",
        (relation,),
    ).fetchall()
    return [(str(name), bool(is_date), bool(is_timestamp)) for name, is_date, is_timestamp in rows]


def _shifted_column(name: str, is_date: bool, is_timestamp: bool, stride: int) -> sql.Composed:
    column = sql.SQL("t.{}").format(sql.Identifier(name))
    if is_date:
        return sql.SQL("{} - m.copy * {}").format(column, sql.Literal(stride))
    if is_timestamp:
        return sql.SQL("{} - make_interval(days => m.copy * {})").format(
            column, sql.Literal(stride)
        )
    return column


def _copy_source_graph(connection: Connection, copies: int, stride: int) -> None:
    connection.execute(
        "create temporary table benchmark_history_ids ("
        "relation text not null,copy integer not null,old_id uuid not null,new_id uuid not null,"
        "primary key(relation,copy,old_id)) on commit drop"
    )
    for relation in SOURCE_TABLES:
        connection.execute(
            sql.SQL(
                "insert into pg_temp.benchmark_history_ids "
                "select {},n,t.id,private.uuid7() from {} t "
                "cross join generate_series(1,{}) cohorts(n) order by n,t.id"
            ).format(sql.Literal(relation), _identifier(relation), sql.Literal(copies - 1))
        )
    for relation, foreign_keys in SOURCE_TABLES.items():
        columns = _columns(connection, relation)
        expressions: list[sql.Composable] = []
        for name, is_date, is_timestamp in columns:
            if name == "id":
                expression = sql.SQL("m.new_id")
            elif name in foreign_keys:
                expression = sql.SQL(
                    "(select r.new_id from pg_temp.benchmark_history_ids r "
                    "where r.relation={} and r.copy=m.copy and r.old_id=t.{})"
                ).format(sql.Literal(foreign_keys[name]), sql.Identifier(name))
            elif (relation, name) in {
                ("private.settlements", "settlement_id"),
                ("private.settlement_acquisitions", "report_id"),
                ("private.settlement_acquisitions", "report_document_id"),
                ("private.data_kiosk_acquisitions", "root_query_id"),
            }:
                expression = sql.SQL("t.{} || ':synthetic-history:' || m.copy").format(
                    sql.Identifier(name)
                )
            else:
                expression = _shifted_column(name, is_date, is_timestamp, stride)
            expressions.append(expression)
        connection.execute(
            sql.SQL(
                "insert into {} ({}) select {} from {} t "
                "join pg_temp.benchmark_history_ids m on m.relation={} and m.old_id=t.id"
            ).format(
                _identifier(relation),
                sql.SQL(",").join(sql.Identifier(name) for name, _, _ in columns),
                sql.SQL(",").join(expressions),
                _identifier(relation),
                sql.Literal(relation),
            )
        )
    for relation, versions in FACT_TABLES.items():
        columns = _columns(connection, relation)
        expressions = [
            sql.SQL("private.uuid7()")
            if name == "id"
            else sql.SQL("m.new_id")
            if name == "version_id"
            else _shifted_column(name, is_date, is_timestamp, stride)
            for name, is_date, is_timestamp in columns
        ]
        connection.execute(
            sql.SQL(
                "insert into {} ({}) select {} from {} t "
                "join pg_temp.benchmark_history_ids m on m.relation={} and m.old_id=t.version_id"
            ).format(
                _identifier(relation),
                sql.SQL(",").join(sql.Identifier(name) for name, _, _ in columns),
                sql.SQL(",").join(expressions),
                _identifier(relation),
                sql.Literal(versions),
            )
        )
    connection.execute(
        "insert into private.data_kiosk_pruned_versions(version_id,created_at) "
        "select m.new_id,t.created_at - make_interval(days => m.copy * %s) "
        "from private.data_kiosk_pruned_versions t join pg_temp.benchmark_history_ids m "
        "on m.relation='private.data_kiosk_preprocess_versions' and m.old_id=t.version_id",
        (stride,),
    )


def _extend_fee_coverage(connection: Connection, days: int) -> int:
    """Preserve old immutable terms; extend the earliest rate in a new selected revision."""
    connection.execute(
        "create temporary table benchmark_history_terms on commit drop as "
        "select s.id seller_sku_id,s.current_terms_version_id old_id,private.uuid7() new_id,"
        "(select max(v.version_number)+1 from public.sku_terms_versions v "
        "where v.seller_sku_id=s.id) version_number "
        "from public.seller_skus s where s.current_terms_version_id is not null"
    )
    connection.execute(
        "insert into public.sku_terms_versions "
        "(id,seller_sku_id,company_id,version_number,fee_period_count,change_reason) "
        "select m.new_id,t.seller_sku_id,t.company_id,m.version_number,t.fee_period_count,"
        "'Synthetic historical fee coverage for read benchmark' "
        "from public.sku_terms_versions t join pg_temp.benchmark_history_terms m on m.old_id=t.id"
    )
    connection.execute(
        "insert into public.sku_fee_periods "
        "(id,terms_version_id,marketplace_name,valid_period,fee_rate_percent) "
        "select private.uuid7(),m.new_id,p.marketplace_name,"
        "case when lower(p.valid_period)=min(lower(p.valid_period)) "
        "over(partition by p.terms_version_id,p.marketplace_name) "
        "then daterange(lower(p.valid_period)-%s,upper(p.valid_period),'[)') "
        "else p.valid_period end,p.fee_rate_percent "
        "from public.sku_fee_periods p "
        "join pg_temp.benchmark_history_terms m on m.old_id=p.terms_version_id",
        (days,),
    )
    result = connection.execute(
        "update public.seller_skus s set current_terms_version_id=m.new_id "
        "from pg_temp.benchmark_history_terms m where s.id=m.seller_sku_id"
    )
    return result.rowcount


VALIDATE = """
do $validate$
declare link record; invalid bigint;
begin
    for link in
        select c.conrelid::regclass child,c.confrelid::regclass parent,
            string_agg(format('c.%I=p.%I',a.attname,b.attname),' and ' order by k.n) matches,
            string_agg(format('c.%I is not null',a.attname),' and ' order by k.n) present
        from pg_constraint c cross join lateral generate_subscripts(c.conkey,1) k(n)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[k.n]
        join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[k.n]
        where c.contype='f' and c.connamespace in ('public'::regnamespace,'private'::regnamespace)
        group by c.oid,c.conrelid,c.confrelid
    loop
        execute format('select count(*) from %s c where %s and not exists '
            '(select 1 from %s p where %s)',link.child,link.present,link.parent,link.matches)
            into invalid;
        if invalid<>0 then raise exception 'History fixture contains invalid foreign keys'; end if;
    end loop;
    if exists (
        select 1 from private.settlement_preprocess_versions v left join
        (select version_id,count(*) n from private.settlement_transactions group by version_id) t
        on t.version_id=v.id where v.row_count<>coalesce(t.n,0)
    ) or exists (
        select 1 from private.data_kiosk_preprocess_versions v left join
        (select version_id,count(*) n from private.data_kiosk_transactions group by version_id) t
        on t.version_id=v.id where v.row_count<>coalesce(t.n,0) and not exists (
            select 1 from private.data_kiosk_pruned_versions p where p.version_id=v.id)
    ) or exists (
        select 1 from private.data_kiosk_preprocess_batches b left join
        (select batch_id,count(*) n from private.data_kiosk_preprocess_versions group by batch_id) v
        on v.batch_id=b.id where b.day_count<>coalesce(v.n,0)
    ) or exists (
        select 1 from public.sku_terms_versions v left join
        (select terms_version_id,count(*) n from public.sku_fee_periods group by terms_version_id) p
        on p.terms_version_id=v.id where v.fee_period_count<>coalesce(p.n,0)
    ) then raise exception 'History fixture inventory count mismatch'; end if;
    if exists (
        select 1 from public.sku_fee_periods p join public.sku_fee_periods q
        on q.terms_version_id=p.terms_version_id and q.marketplace_name=p.marketplace_name
        and q.id>p.id and q.valid_period && p.valid_period
    ) then raise exception 'History fixture has overlapping fee periods'; end if;
    if exists (
        select 1 from private.data_kiosk_days d join private.data_kiosk_pruned_versions p
        on p.version_id=d.current_version_id
    ) or exists (
        select 1 from private.data_kiosk_transactions t join private.data_kiosk_pruned_versions p
        on p.version_id=t.version_id
    ) then raise exception 'History fixture violates pruning/current-version consistency'; end if;
    if exists (
        select 1 from private.data_kiosk_transactions t
        join private.data_kiosk_preprocess_versions v on v.id=t.version_id
        join private.data_kiosk_days d on d.id=v.day_id
        where (t.seller_namespace,t.marketplace_name,t.activity_date) is distinct from
              (d.seller_namespace,d.marketplace_name,d.activity_date)
    ) or exists (
        select 1 from private.settlement_transactions t
        join private.settlement_preprocess_versions v on v.id=t.version_id
        join private.settlements s on s.id=v.settlement_id
        where t.seller_namespace is distinct from s.seller_namespace
    ) then raise exception 'History fixture source/header identity mismatch'; end if;
    if exists (
        select 1 from pg_temp.benchmark_history_terms m
        join public.sku_terms_versions old on old.id=m.old_id
        join public.sku_terms_versions new on new.id=m.new_id
        join public.seller_skus s on s.id=m.seller_sku_id
        where old.company_id is distinct from new.company_id
            or old.seller_sku_id is distinct from new.seller_sku_id
            or s.current_terms_version_id is distinct from new.id
    ) then raise exception 'History fixture changed current company ownership'; end if;
end;
$validate$;
"""


def _stats(connection: Connection) -> dict[str, object]:
    counts: dict[str, object] = {}
    for label, relation in {
        "settlement_facts": "private.settlement_transactions",
        "data_kiosk_facts": "private.data_kiosk_transactions",
        "settlement_headers": "private.settlements",
        "day_headers": "private.data_kiosk_days",
        "settlement_versions": "private.settlement_preprocess_versions",
        "day_versions": "private.data_kiosk_preprocess_versions",
        "batches": "private.data_kiosk_preprocess_batches",
        "settlement_acquisitions": "private.settlement_acquisitions",
        "data_kiosk_acquisitions": "private.data_kiosk_acquisitions",
        "pruned_versions": "private.data_kiosk_pruned_versions",
        "companies": "public.companies",
        "accounts": "public.app_accounts",
        "seller_skus": "public.seller_skus",
    }.items():
        row = connection.execute(sql.SQL("select count(*) from {}").format(_identifier(relation)))
        counts[label] = cast(tuple[int], row.fetchone())[0]
    inventory = connection.execute(
        "select "
        "(select count(*) from private.data_kiosk_preprocess_versions where row_count=0),"
        "(select count(*) from private.settlement_preprocess_versions v where not exists "
        "(select 1 from private.settlements h where h.current_version_id=v.id)),"
        "(select count(*) from private.data_kiosk_preprocess_versions v where not exists "
        "(select 1 from private.data_kiosk_days h where h.current_version_id=v.id))"
    ).fetchone()
    if inventory is None:
        raise RuntimeError("Missing fixture inventory statistics")
    counts.update(
        zip(
            ("empty_day_versions", "obsolete_settlement_versions", "obsolete_day_versions"),
            inventory,
            strict=True,
        )
    )
    for source, relation, date in (
        ("settlement", "private.settlement_transactions", "posted_date"),
        ("data_kiosk", "private.data_kiosk_transactions", "activity_date"),
    ):
        row = connection.execute(
            sql.SQL("select min({})::text,max({})::text,count(distinct {}) from {}").format(
                sql.Identifier(date),
                sql.Identifier(date),
                sql.Identifier(date),
                _identifier(relation),
            )
        ).fetchone()
        if row is None:
            raise RuntimeError("Missing fixture date statistics")
        counts[f"{source}_dates"] = dict(zip(("first", "last", "distinct_days"), row, strict=True))
    return counts


def _protected_data(connection: Connection) -> str:
    """Hash original payout payloads and account/company membership without exporting them."""
    rows: list[object] = []
    for relation in (*PAYOUT_TABLES, "public.app_accounts", "public.companies"):
        result = connection.execute(
            sql.SQL(
                "select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' "
                "order by to_jsonb(t)::text),'')) from {} t"
            ).format(_identifier(relation))
        ).fetchone()
        rows.append(result)
    return digest(rows)


def build_history(connection: Connection, copies: int = 10) -> dict[str, object]:
    """Atomically add dated cohorts, validate integrity and return sanitized setup metadata."""
    if connection.info.dbname != DATABASE or connection.info.port != PORT:
        raise ValueError("History setup is restricted to aselbox_opt_broad on local port 55422")
    if connection.info.host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("History setup requires an explicit loopback connection")
    if connection.info.transaction_status != TransactionStatus.IDLE:
        raise ValueError("History setup requires an idle connection and owns its transaction")
    if type(copies) is not int or not 2 <= copies <= 20:
        raise ValueError("Use between 2 and 20 total temporal cohorts")
    started = time.perf_counter()
    with connection.transaction():
        connection.execute("set local statement_timeout='10min'")
        connection.execute("set local timezone='UTC'")
        mode = connection.execute("show session_replication_role").fetchone()
        if mode != ("origin",):
            raise ValueError("History setup requires normal trigger execution on entry")
        before = _stats(connection)
        if not before["settlement_facts"] or not before["data_kiosk_facts"]:
            raise ValueError("History setup requires source facts in both datasets")
        if connection.execute(
            "select exists(select 1 from private.data_kiosk_acquisitions "
            "where strpos(root_query_id,':synthetic-history:')>0)"
        ).fetchone() != (False,):
            raise ValueError("Refusing repeated history expansion")
        shape = catalog_fingerprint(connection)
        protected = _protected_data(connection)
        span = connection.execute(
            "select max(activity_day)-min(activity_day) from ("
            "select posted_date as activity_day from private.settlement_transactions union all "
            "select activity_date as activity_day from private.data_kiosk_days) dates"
        ).fetchone()
        stride = max(366, int(cast(tuple[int], span)[0]) + 1)
        connection.execute("set local session_replication_role=replica")
        _copy_source_graph(connection, copies, stride)
        terms = _extend_fee_coverage(connection, stride * (copies - 1))
        connection.execute("set local session_replication_role=origin")
        connection.execute(VALIDATE)
        after = _stats(connection)
        for key in before:
            if isinstance(before[key], int):
                factor = 1 if key in {"companies", "accounts", "seller_skus"} else copies
                if after[key] != cast(int, before[key]) * factor:
                    raise RuntimeError(
                        "History fixture cardinalities do not match the requested factor"
                    )
        if _protected_data(connection) != protected or catalog_fingerprint(connection) != shape:
            raise RuntimeError("History fixture changed protected data or application definitions")
        for relation in (
            *SOURCE_TABLES,
            *FACT_TABLES,
            "public.sku_terms_versions",
            "public.sku_fee_periods",
            "public.seller_skus",
        ):
            connection.execute(sql.SQL("analyze {}").format(_identifier(relation)))
        if connection.execute("show session_replication_role").fetchone() != ("origin",):
            raise RuntimeError("History setup did not restore normal trigger execution")
    return {
        "database": DATABASE,
        "total_temporal_cohorts": copies,
        "cohort_stride_days": stride,
        "cohort_offsets_days": [-stride * copy for copy in range(copies)],
        "before": before,
        "after": after,
        "new_selected_terms_revisions": terms,
        "setup_seconds": round(time.perf_counter() - started, 3),
        "schema_indexes_and_access_unchanged": True,
        "original_payouts_and_account_membership_unchanged": True,
        "normal_trigger_execution_restored": True,
        "integrity_checks": (
            "All foreign keys/current identity pairs, source/batch/fee inventories, fee "
            "exclusions, pruning markers, source/header identity and ownership checked "
            "before commit."
        ),
        "fee_assumption": (
            "Each marketplace's earliest configured fee rate extends backwards in a new selected "
            "revision; original terms and payout references are retained."
        ),
        "limitations": (
            "Shifted seasonal seed windows and repeated value/SKU distributions are synthetic. "
            "Raw JSON/archive references are not reconstructed for historical replay. Revision "
            "tokens are unchanged during fixture-only trigger suppression; query benchmarks "
            "must use fresh reads."
        ),
    }
