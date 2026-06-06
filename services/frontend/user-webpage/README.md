# User Webpage POC

React + TypeScript + Vite webpage for local Supabase order transactions.

## Tooling

- Package manager: `pnpm`, run only through Docker.
- TypeScript linting: ESLint via `pnpm run lint`.
- TypeScript formatting: Prettier via `pnpm run format` or `pnpm run format:write`.

## Local Accounts

The Supabase seed creates these local proof-of-concept accounts:

- `admin@example.com` / `password123`
- `user-one@example.com` / `password123`
- `user-two@example.com` / `password123`

The webpage signs in with Supabase Auth and queries `public.order_transactions_view`.
RLS limits normal users to their company transactions; the admin account can see all current order transactions.

## Docker pnpm Commands

Run these from `frontend/user-webpage`.

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  node:24-alpine corepack pnpm install --store-dir /app/.pnpm-store
```

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -p 5173:5173 \
  -v "$PWD":/app \
  -w /app \
  node:24-alpine corepack pnpm run dev --host 0.0.0.0
```

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  node:24-alpine corepack pnpm run lint
```

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  node:24-alpine corepack pnpm run format
```

```sh
docker run --rm -u "$(id -u):$(id -g)" \
  -e COREPACK_HOME=/tmp/corepack \
  -v "$PWD":/app \
  -w /app \
  node:24-alpine corepack pnpm run build
```

## Supabase Data Refresh

Run these from the repository `services` directory.

```sh
supabase start --workdir db
```

The Amazon SP-API credentials live in `sync/.env`. Do not print those values.

```sh
conda run -n A-SelBox python sync/run_download.py --days 60
conda run -n A-SelBox python sync/run_preprocess_order_transactions.py \
  --all-settlements \
  --preprocess-description "60-day real SP-API refresh"
```

The current proof-of-concept table uses real SP-API settlement report data inserted into
`private.settlements`, `private.settlement_transactions`, and preprocessed into
`private.order_transactions`.
