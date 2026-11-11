# Leash

Human-in-the-loop authorization for AI agents. A website assumes any logged-in activity might be an
agent; small actions pass silently, and anything beyond the limits the user has set needs a fresh
passkey (Touch ID) assertion bound to that one action.

> Work in progress — built milestone by milestone. Currently at **milestone 1 (skeleton)**.

## Setup

Requires Node 20.12+ and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm db:seed
pnpm dev
```

| App | URL | What |
|---|---|---|
| `apps/leash` | http://localhost:3000 | Leash service: API, dashboard, verify page (Next.js) |
| `apps/shop` | http://localhost:3001 | Demo shop (Express) — login `demo@example.com` / `demo1234` |
| `apps/jobs` | http://localhost:3002 | Demo job board (Express) — same login |
| `packages/sdk` | | `@leash/node`, the Express middleware sites use |
| `packages/shared` | | Types, constraint evaluation, canonical JSON hashing |

Other commands: `pnpm test`, `pnpm typecheck`, `pnpm demo:reset`, `pnpm db:generate` (after editing
`apps/leash/src/db/schema.ts`).

## Decisions

- **One root `.env`, prefixed per site.** The shop and jobs credentials are `SHOP_LEASH_SITE_ID` /
  `SHOP_LEASH_SITE_SECRET` and `JOBS_…`, since all apps read the same file.
- **Workspace packages are consumed as TypeScript source** (no build step): Next.js transpiles
  `@leash/shared`, the Express apps run under `tsx`.
- **Leash schema is applied by Drizzle migrations at startup** (`apps/leash/drizzle`), so dev, scripts
  and in-memory test databases all get the same schema.
- **Demo sites use plain template strings** (auto-escaping `html` tag) and `better-sqlite3` directly,
  with their own password login — no Leash dependency for login, and fewer dependencies.
- **zod for shape validation.** The manifest is validated with a zod schema (discriminated union on
  constraint `type`), and every Leash API request body gets a zod schema. Policy evaluation stays plain
  code — it is logic, not shape checking.
- **Period boundaries use server-local time** ("today" starts at local midnight, "this month" on the 1st).
- **Limits are inclusive**: a $100 purchase passes a $100 per-transaction limit.
- **Fail-safe policy rules beyond the spec:** a constraint added to a manifest after the user linked
  makes that action require a human until the user reviews it (same as a new action); a missing
  `ceiling` equals the `default`; a missing or non-numeric param blocks the action.
- **Site secrets are stored as SHA-256** — they are high-entropy random strings, so a slow hash adds nothing.
- **TypeScript is pinned to 5.x** for compatibility with the Next.js toolchain.
