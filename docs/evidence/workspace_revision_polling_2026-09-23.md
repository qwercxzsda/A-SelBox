# Lightweight workspace revision polling

The `workspace_revisions` REST RPC replaces repeated financial reads used only to
discover whether anything changed. It reads the caller's application account and
at most three tiny revision records. It does not aggregate, inspect transaction
facts, or invoke the live financial view.

## API contract

```http
GET /rest/v1/rpc/workspace_revisions?p_sources=%7Bsettlement,data_kiosk,fees%7D
Authorization: Bearer <user access token>
```

The frontend uses this read-only GET request with browser caching disabled. A POST
with JSON `{"p_sources":["settlement","data_kiosk","fees"]}` is also supported by
PostgREST for the same function. No SQL is sent by the frontend.

Example response:

```json
{
  "account": {
    "user_id": "<authenticated user UUID>",
    "access_role": "company_member",
    "company_id": "<current company UUID>"
  },
  "revisions": {
    "settlement": "<opaque UUID token>",
    "data_kiosk": "<opaque UUID token>",
    "fees": "<opaque UUID token>"
  }
}
```

Only requested keys appear. Omission requests all three; an empty array performs
an account-only check. A source with no publication since installing the migration
returns the string `"0"`. Tokens support equality comparison only; they are not
timestamps, version numbers, row counts, or ordered identifiers. Installation
does not backfill or scan existing financial data: the first client poll records
the baseline before its initial data load.

The RPC derives role and company from `app_accounts` using `auth.uid()` on every
call. It accepts no user/company argument and returns no source metadata or private
rows. Unconfigured or revoked accounts receive permission denied. The public
function is an invoker wrapper around a private, explicitly granted definer
function with an empty search path. Anonymous/service roles cannot execute it;
authenticated clients cannot read or modify the private token table.

## What changes each token

| Token | Publication event | Scope |
| --- | --- | --- |
| `settlement` | Current settlement preprocess pointer changes | Global |
| `data_kiosk` | Current Data Kiosk day preprocess pointer changes | Global |
| `fees` | Current SKU terms/ownership pointer changes; company labels change | Own company for members; global for administrators |

Source tokens deliberately have global scope. An import for a different company
can cause an unnecessary refresh, but this avoids scanning facts or adding
publication/ownership synchronization to calculate affected companies. It also
cannot miss a concurrent ownership transfer. Fee transfer rotates tokens for both
the former and new company. Fee tokens therefore invalidate ownership-dependent
transaction reads and company/SKU lookups as well as current fee tables.

Deferred triggers update tokens in the publication transaction, after all import
inserts finish. A small row upsert rotates a token once per transaction, using an
internal `xid8` to coalesce multi-day batches. Commit exposes financial changes and
their tokens atomically; rollback exposes neither. There are no new advisory locks
and no transaction-fact scans on either polling or token publication. Concurrent
updates to the same tiny token row briefly serialize at transaction end.

Current-pointer changes cover reprocessing an old date, replacing nonempty data
with an empty complete result, and fee reassignment. Merely downloading an archive
or retaining a historical Data Kiosk result that does not become current does not
rotate a token. Existing schema guards still reject clearing/deleting published
identities and mutating published inventories. This is why `MAX(preprocess_version)`
or the latest transaction date would not be a reliable replacement.

Account-management lists and frozen payout-report publications are not represented
by these three financial tokens. They need their own targeted refresh while open.

## Verification

`services/db/supabase/tests/test_workspace_revisions.py` verifies authentication,
current-account reassignment/revocation, requested subsets and argument validation,
company fee isolation, ownership transfer, company rename, transaction coalescing,
rollback, backdated reprocessing, empty replacement, and retained historical
results. PostgreSQL transaction statistics confirm that polling reads no rows from
either fact table.

The full database regression suite passed 114 tests, including 11 dedicated
revision tests. SQL/Python lint and Python type checking pass with the configured
Anaconda interpreter.

A small disposable-database measurement used 200 warm member RPC SQL calls after
10 warmups, over one local connection. Median client-observed SQL round trip was
0.325 ms with no facts and 0.313 ms after inserting 5,000 settlement facts. These
figures exclude HTTP, authentication gateway, and network latency; they demonstrate
the small polling operation, not production capacity. The structural absence of
fact reads is the important scaling property.

The frontend passes 89 unit tests and 99 Playwright browser tests, including 16
polling regressions. Those checks cover quiet unchanged polls, individual source
dependencies, fees and ownership lookups, account revocation/reassignment, hidden
and offline pages, reconnects, request deduplication, startup ordering, pending
checks across token rotation, failed-refetch recovery, and queued manual retries.
Formatting, ESLint, TypeScript, and the production build pass.

The migration was applied atomically to the existing local frontend seed on port
55422 without resetting data. The security advisor reported no warnings or errors.
Member and operator checks confirmed requested subsets and account scoping; one
warm member `EXPLAIN ANALYZE` reported 0.174 ms execution and nine shared-buffer
hits. This single local SQL observation excludes HTTP and is not a latency promise.
The migration and application changes remain uncommitted.
