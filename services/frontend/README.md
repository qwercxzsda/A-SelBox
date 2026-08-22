# Frontend

The published SKU economics client is in `services/frontend/user-webpage`.

- Stack: React, TypeScript, Vite, and pnpm.
- Run every `node`, `npm`, `npx`, `corepack`, and `pnpm` command through Docker;
  native host execution is unsupported.
- The Docker-only `pnpm run check` enforces deterministic Prettier output,
  zero-warning type-aware and accessibility ESLint rules, unit tests,
  TypeScript, and the production build.

See the [user webpage README](user-webpage/README.md) for the exact Docker-only
commands and canonical Supabase API contract.
