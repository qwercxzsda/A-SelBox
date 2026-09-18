# Company Finance webpage

React, TypeScript, and Vite client for the current company fee and source-data schema. Mantine
supplies shared controls, styling, and an accessible row-details drawer. TanStack Table manages
sorting, pagination, and single-row selection; sorting and pagination still run on the server.
TanStack Query manages requests, cancellation, and an in-memory page cache.

## Data and access

The app signs in with an existing Supabase Auth account, then loads its `app_accounts` role and
company. It reads these models through Supabase REST with that user's access token:

| Tab                  | REST model                      | Visibility                                                              |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| Live calculations    | `live_company_components`       | Current assignments and fees; members see their company                 |
| Settlement           | `settlement_preprocess_entries` | Members see current own-company results; operators see retained history |
| Data Kiosk           | `data_kiosk_preprocess_entries` | Members see current own-company results; operators see retained history |
| Current fees         | `current_sku_fee_periods`       | Current fee periods; members see their company                          |
| Payout reports       | `company_payout_reports`        | Operators only                                                          |
| Application accounts | `app_accounts`                  | Operators only                                                          |

`companies` and `company_skus` supply company and SKU display names. Lookup queries are paginated so
deployments with more than 1,000 assignments still resolve SKU labels. The account lookup filters by
the authenticated user ID even for operators. RLS enforces all data access; hiding tabs is only a
navigation choice.

The frontend currently supports reading and inspecting these results. Account administration, fee
publication, and historical fee browsing are not implemented in this UI; the database permissions
and REST operations are documented in the [access guide](../../../docs/access_control.md).

Financial values arrive as PostgREST CSV and remain exact decimal strings. Missing fees remain NULL
and display as a dash with the row's resolution status. Comparison components are labeled and are
not presented as contributions to a total. The UI does not calculate financial totals or combine
currencies. Search treats SKU punctuation literally, and pagination uses stable identity
tie-breakers. Fee date ranges include the start and exclude the end.

Sessions are held in memory, refreshed while the page is open, and cleared on sign-out. Reloading
the page requires signing in again. Sign-out ends only the current session. User, role, or company
changes clear the previous workspace's selection and loaded rows.

Each authenticated workspace owns a separate Query cache, discarded on sign-out or a user, role, or
company change. Pages are fresh for 30 seconds; only network and server errors retry once. Refresh
rechecks the account and display-name lookups before invalidating cached pages. A changed row count
also invalidates other pages of the same filtered dataset. Search is debounced by 250 ms.

## Configuration

Set both values in an ignored `services/frontend/user-webpage/.env.local` before starting Vite:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:55421
VITE_SUPABASE_PUBLISHABLE_KEY=<public anon or publishable key for that instance>
```

The URL is used by the browser, so it must be reachable from the browser's host. Port `55421` is the
existing real-seed test stack; a standard local Supabase stack may use `54321` instead. There is no
implicit URL or credential fallback in development or production. Only a public publishable key or
legacy `anon` JWT may enter client code. Never put a secret or `service_role` key in a `VITE_`
variable. Production requires HTTPS; plain HTTP is accepted only for local hosts.

The strict check uses non-routable public test settings to exercise the production build. It does
not contact or change a database.

## Docker-only Node tooling

Do not run `node`, `npm`, `npx`, `corepack`, or `pnpm` directly on the host. Every Node and
package-manager command for this project must run in Docker. Run the commands below from
`services/frontend/user-webpage`.

Use the same pinned Playwright image for development and checks so Vite's native dependencies and
the browser runner use the same Linux environment. If dependencies were installed with the old
Alpine image, reinstall them in this image before starting Vite or running checks.

Install the lockfile exactly:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble corepack pnpm install --frozen-lockfile \
  --store-dir /app/.pnpm-store
```

Run the complete strict check. It fails on a formatting difference, any ESLint warning, a unit-test
failure, a TypeScript error, a production-build error, or a browser regression:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble corepack pnpm run check
```

Apply Prettier, then rerun the complete check:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble corepack pnpm run format:write
```

Start Vite:

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -p 127.0.0.1:5173:5173 \
  -v "$PWD":/app \
  -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble corepack pnpm run dev --host 0.0.0.0
```

Open `http://127.0.0.1:5173`.

## Browser regression tests

The Playwright suite exercises the rendered app with synthetic Auth and REST responses. It checks
row inspection by mouse and keyboard, drawer focus and closing, server pagination/sort/search,
out-of-order responses, session cache isolation, and recovery after denied requests. It does not
require Supabase, a test account, or a database reset. Every API request targets the reserved
`example.invalid` domain and is intercepted by the test fixture.

Use the Playwright Docker image matching the exact `@playwright/test` version in the lockfile:

```sh
docker run --rm --init --ipc=host \
  -u "$(id -u):$(id -g)" \
  -v "$PWD":/app \
  -w /app \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  node node_modules/@playwright/test/cli.js test
```

The configuration starts its own Vite server with public dummy settings. A failed test retains a
trace and screenshot under `test-results/`. The existing fast Node tests continue to verify the CSV,
exact decimal, API validation, and view-model contracts. Run both suites when changing user
interactions, request handling, or authentication.

## Existing frontend test database

Use the currently running seeded database without resetting it. The September 15, 2026 test stack
uses API port `55421` and Studio port `55423`, with these dummy accounts:

| Login                   | Role           | Company            |
| ----------------------- | -------------- | ------------------ |
| `operator@example.test` | Operator       | All companies      |
| `member-a@example.test` | Company member | Frontend Company A |
| `member-b@example.test` | Company member | Frontend Company B |

The local-only password for these dummy accounts is `Frontend-Test-2026!`. The test data includes
roughly 90 days of Data Kiosk results, retained Settlement results, and current fees of 4.8% and
5.2%. Payout tables are empty, so the payout tab initially shows its empty state. Neither account
creation nor fee/source/payout publication is part of frontend startup or the offline check.

The seed and source archives are private local artifacts and are not tracked by Git. See the
[database guide](../../db/supabase/README.md) for database setup and SQL/RLS checks. Do not reset an
existing test database just to start or validate this frontend.
