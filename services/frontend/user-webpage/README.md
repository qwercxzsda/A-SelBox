# User webpage

React, TypeScript, and Vite client for the published settlement-grounded SKU economics API.

## Data contract

The webpage signs in through Supabase Auth and reads only the canonical public models:

- `public.sku_economics_transactions`: one published `COMPANY_SKU` allocation target per row;
- `public.account_level_settlement_transactions`: published `COMPANY_ONLY` and `UNASSIGNED`
  non-excluded targets; and
- `public.excluded_settlement_movements`: administrator-visible treasury and balance movements
  excluded from P&L.

It does not query raw Settlement objects or the removed legacy order, no-SKU, allocation, or
rolling-economics views. Difference is displayed separately from elaborated and Settlement amounts.
Numeric result sets use PostgREST CSV so PostgreSQL `numeric` values cross the JavaScript boundary
as decimal text; the UI never parses money through binary floating point or aggregates currencies.

Company users see only their company through RLS. Administrators see every published target,
including unassigned and excluded rows.

## Local accounts

The deterministic local seed creates these non-production accounts:

- `user-one@example.com` / `password123`: owns `Local Seed Company`;
- `user-two@example.com` / `password123`: owns an empty company for RLS checks; and
- `admin@example.com` / `password123`: can inspect all published rows.

## Docker-only Node tooling

Do not run `node`, `npm`, `npx`, `corepack`, or `pnpm` directly on the host. Every Node and
package-manager command for this project must run in Docker. Run the commands below from
`services/frontend/user-webpage`.

Install the lockfile exactly:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  node:24-alpine corepack pnpm install --frozen-lockfile \
  --store-dir /app/.pnpm-store
```

Run the complete strict check. It fails on a formatting difference, any ESLint warning, a unit-test
failure, a TypeScript error, or a production-build error:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  node:24-alpine corepack pnpm run check
```

Apply Prettier, then rerun the complete check:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  node:24-alpine corepack pnpm run format:write
```

Start Vite:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -p 5173:5173 \
  -v "$PWD":/app \
  -w /app \
  node:24-alpine corepack pnpm run dev --host 0.0.0.0
```

Open `http://127.0.0.1:5173`.

## Configuration

The Vite development server defaults to the local Supabase instance at `http://127.0.0.1:54321`.
Production builds have no credential or URL fallback: both variables below must be set at build
time, or Vite fails the build with an explicit configuration error. The strict `check` command uses
non-routable test values solely to exercise the production build.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Only a publishable key may enter client code. Never expose a Supabase secret or `service_role` key
through a `VITE_` variable.

## Local database

From the repository root, use only the disposable local project:

```sh
supabase start --workdir services/db
supabase db reset --local --workdir services/db
supabase migration up --local --include-all --workdir services/db
conda run -n A-SelBox python \
  services/db/supabase/tests/run_local_seed_validation.py --apply-seed
```

Never replace `--local` with `--linked`. See the [database README](../../db/supabase/README.md) for
the full SQL/RLS verification workflow.
