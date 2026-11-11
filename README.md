# Leash

**Human-in-the-loop authorization for AI agents.** Built for a hackathon on the theme "prove you are human".

Detecting bots is no longer reliable, and people want their own AI agents to act for them. Leash
turns the question around. A website stops asking "are you a bot?" and assumes any logged-in
activity might be an agent. It asks for proof of a human — a passkey / Touch ID assertion — only
when an action goes beyond the limits the user has set.

- **Who the user is** comes from the website's existing login session. Leash does not replace it.
- **Whether a human is present** is proven only by a fresh passkey assertion with user
  verification, bound to one specific action.
- **Any logged-in request without a human proof is "this user's agent"** and gets the user's agent
  permissions for that site.
- There is **no agent token and no agent-side SDK**. Existing browser agents work unmodified.

It works like a bank's step-up authentication: small actions pass silently, large or sensitive
ones need a fingerprint. An agent cannot press Touch ID, so it is naturally capped.

## Setup

Requires Node 20.12+, pnpm, and a browser with a platform authenticator (Chrome or Safari with
Touch ID on a Mac).

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm db:seed
```

```bash
pnpm dev
```

| App | URL | What |
|---|---|---|
| `apps/leash` | http://localhost:3000 | Leash service: API, dashboard, verify page (Next.js) |
| `apps/shop` | http://localhost:3001 | Demo shop "Corner Shop" (Express) |
| `apps/jobs` | http://localhost:3002 | Demo job board "Hireboard" (Express) |
| `packages/sdk` | | `@leash/node`, the Express middleware sites use — see [its README](packages/sdk/README.md) |
| `packages/shared` | | Types, manifest validation, constraint evaluation, canonical JSON hashing |

Both demo sites have the login **`demo@example.com` / `demo1234`**. Leash accounts are passkey-only:
open http://localhost:3000 — always `localhost`, not `127.0.0.1`, because the passkey is bound to
that name — and create an account with Touch ID, or let the first blocked action create one for you.

Other commands:

| Command | |
|---|---|
| `pnpm test` | Unit and integration tests (Vitest) |
| `pnpm typecheck` | Type-check every package |
| `pnpm demo:reset` | Clear events, challenges, orders and applications. Keeps users, passkeys and links. |
| `pnpm demo:reset --prefill-jobs` | Same, then record five job applications for today so the sixth is blocked immediately |
| `pnpm db:generate` | Regenerate the Drizzle migration after editing `apps/leash/src/db/schema.ts` |

## Integrating a site

This is the whole integration in the demo shop ([apps/shop/src/leash.ts](apps/shop/src/leash.ts)
and the routes in [apps/shop/src/server.ts](apps/shop/src/server.ts)):

```ts
export const leash = createLeash({
  siteId: process.env.SHOP_LEASH_SITE_ID!,
  secret: process.env.SHOP_LEASH_SITE_SECRET!,
  leashUrl: process.env.LEASH_URL!,
  getUserId: (req) => req.user?.id,
  blockedPath: "/verification-required",
  actions: {
    purchase: {
      label: "Purchase items",
      mode: "auto",
      constraints: {
        amount:  { type: "max", param: "amount", label: "Per-transaction limit ($)", default: 100, ceiling: 5000 },
        monthly: { type: "sum_per_period", param: "amount", period: "month", label: "Monthly limit ($)", default: 500, ceiling: 20000 },
      },
    },
    change_address: { label: "Change shipping address", mode: "human" },
  },
});

app.post("/checkout", requireLogin, loadProduct,
  leash.protect("purchase", (req) => ({
    amount: req.product.price,                       // server-side value, never client input
    summary: `${req.product.name} — $${req.product.price}`,
  }), { returnTo: (req) => `/checkout/resume?product_id=${req.product.id}` }),
  placeOrder);
```

**Trust rule:** the params a site sends must come from its server-side state (the price in its
database), never from numbers the client supplied.

## Architecture

### The flow

```
 Browser (human or agent)        Site (shop + @leash/node)              Leash
        │  POST /checkout              │                                   │
        ├─────────────────────────────►│  POST /api/v1/authorize           │
        │                              ├──────────────────────────────────►│ evaluate the user's policy
        │                              │   { decision: "allow" }           │ → event: auto_allowed
        │   order confirmed            │◄──────────────────────────────────┤
        │◄─────────────────────────────┤                                   │
        │                                                                  │
        │  POST /checkout ($1,500)     │  POST /api/v1/authorize           │
        ├─────────────────────────────►├──────────────────────────────────►│ over the limit
        │                              │   { decision: "require_human",    │ → challenge (5 min)
        │  303 → "needs verification"  │     verify_url, reason }          │ → event: blocked
        │◄─────────────────────────────┤◄──────────────────────────────────┤
        │                                                                  │
        │  GET /verify/ch_…  (full-page redirect — an agent stops here)    │
        ├─────────────────────────────────────────────────────────────────►│
        │  passkey assertion (Touch ID), bound to this challenge           │
        ├─────────────────────────────────────────────────────────────────►│ verify → approved
        │  302 → return_url?leash_proof=<JWT, EdDSA, 2 min>                │ → mint proof
        │◄─────────────────────────────────────────────────────────────────┤
        │  GET /checkout/resume?…      │  verify JWT locally (JWKS), then  │
        ├─────────────────────────────►│  POST /api/v1/authorize + proof   │
        │                              ├──────────────────────────────────►│ proof: approved → consumed
        │                              │   { decision: "allow",            │ → event: human_verified
        │   order confirmed            │     verified: true }              │
        │◄─────────────────────────────┤◄──────────────────────────────────┤
```

A remote human can unblock an agent too: the pending request appears in their Leash dashboard on
another device, they approve it there with their passkey, and the verify page the agent is
sitting on — which polls the challenge every second — receives the proof and redirects by itself.

### Components

- **Leash service** (`apps/leash`): Next.js App Router, SQLite through Drizzle, Better Auth with
  its passkey plugin for accounts and dashboard sessions, SimpleWebAuthn for action-bound
  ceremonies, `jose` for EdDSA proof JWTs and the JWKS.
  - `src/lib/authorize.ts` — site authentication, `PUT /manifest`, `POST /authorize`
  - `src/lib/challenges.ts` — approve / deny / redirect
  - `src/lib/webauthn.ts` — fresh, bound passkey ceremonies
  - `src/lib/proof.ts`, `src/lib/keys.ts` — proof JWTs and the signing key
- **SDK** (`packages/sdk`): `createLeash`, `leash.protect`, `leash.settingsHandler`. No database changes on the site.
- **Shared** (`packages/shared`): pure functions — `normalizeManifest`, `effectivePolicy`,
  `evaluateAction`, `hashParams` — used by both the SDK and the service.
- **Demo sites** (`apps/shop`, `apps/jobs`): ordinary email + password sites with server-rendered
  HTML. They do not depend on Leash for login.

### Policy

Each site declares its actions in the SDK config; the SDK pushes this manifest to Leash on startup.

- `mode: "auto"` passes without a human while every constraint holds; `mode: "human"` always needs one.
- Constraints: `max`, `sum_per_period`, `count_per_period` (periods `day`, `month`). The type is a
  discriminated union, so `allowlist` can be added later.
- A user's policy is a copy of the site's defaults taken when they link, then edited by them. The
  effective limit is always `min(user value, current site ceiling)`.
- Fail safe everywhere: missing `mode` → human; missing `default` → 0; no link → site defaults;
  actions added after linking → human until reviewed; paused → everything needs a human.
- Period counters (monthly spend, daily count) are computed from `auto_allowed` events. There is no counter table.

### Protocol

Site → Leash calls are server-to-server, authenticated with `Authorization: Bearer <site secret>`
and `Leash-Site: <site id>`. Leash stores only a hash of the secret.

| Endpoint | |
|---|---|
| `PUT /api/v1/manifest` | The SDK sends `{ actions }` on startup. Validated with zod and stored. |
| `POST /api/v1/authorize` | `{ site_user_id, action, params, summary, proof?, return_url }` → `{ decision: "allow", verified }` or `{ decision: "require_human", challenge_id, verify_url, reason }`. One database transaction. |
| `GET /api/v1/jwks.json` | Public key(s) for verifying proof JWTs. |
| `GET /verify/:challengeId` | The page (on the Leash origin) where a human approves or denies. |

A proof JWT is signed with EdDSA, expires two minutes after approval, and carries `iss`, `aud`
(= site id), `jti`, `site_user_id`, `action` and `params_hash` (SHA-256 of the canonical JSON of
the params).

### Data model (Leash)

| Table | |
|---|---|
| `sites` | `id`, `name`, `origin`, `secret_hash`, `manifest`, `updated_at` |
| `links` | A Leash user ↔ a site account, with their `policy` and `paused`. Unique on (`site_id`, `site_user_id`). |
| `challenges` | One request for human proof: action, `params`, `params_hash`, `summary`, `reason`, `return_url`, `status` (`pending` / `approved` / `denied` / `expired` / `consumed`), `proof_jti`, `approved_at`, `approved_by`, `expires_at` |
| `events` | Audit log: `auto_allowed` / `human_verified` / `blocked` |
| `signing_keys` | The EdDSA key pair for proofs, generated on first use |
| `ceremonies` | Single-use nonces for Leash's own WebAuthn ceremonies |
| `user`, `session`, `account`, `verification`, `passkey` | Managed by Better Auth |

### Security rules

1. **A session is not a human.** The agent drives the same browser, with the same cookies, and can
   click any button. A Leash session cookie only identifies the user; it never approves anything.
2. **Every approval needs a fresh passkey assertion with user verification**, bound to what is
   being approved. The WebAuthn challenge is `SHA-256(nonce ‖ purpose ‖ binding)`:
   - the `nonce` is random, stored server-side and single use, so an assertion cannot be replayed;
   - the `binding` is the challenge id plus `params_hash` (or the link id plus the hash of the new
     policy), recomputed by the server when the assertion comes back, so an assertion for one thing
     cannot authorize another.
   The same applies to saving settings and to un-pausing — otherwise an agent could raise its own limits.
3. **The passkey must belong to the Leash account that owns the link.** For a first-time user the
   challenge was created by the site's server with its secret, so the `site_user_id` is trusted and
   the link is created on that first approval.
4. **Proofs are single use and narrow.** `approved → consumed` happens once, inside the authorize
   transaction; the proof is bound to site, user, action and exact params, and lasts two minutes.
5. **Fail closed.** If Leash is unreachable, slow, or answers anything unexpected, the SDK responds
   503 and the action does not happen.
6. **Params are server-side.** See the trust rule above.
7. **WebAuthn happens only on the Leash origin** (`http://localhost:3000`, rpID `localhost`), reached
   by a full-page redirect. No popups or iframes. `return_url` must be on the site's registered origin.

## Testing

```bash
pnpm test
```

- `packages/shared` — constraint evaluation, effective policy (defaults, ceilings, new actions,
  paused), canonical params hashing.
- `apps/leash/src/test/authorize.test.ts` — `/authorize` against an in-memory database: auto-allow,
  block, proof accepted once, replay rejected, different params / user / action / site rejected,
  expired challenge and expired proof rejected, period limits accumulating, paused links, linking.
- `apps/leash/src/test/sdk-e2e.test.ts` — an Express site using the SDK against the Leash handlers
  over real HTTP, including the full block → approve → resume → replay path.
- `packages/sdk/src/sdk.test.ts` — config validation and fail-closed behaviour when Leash is down,
  slow, erroring or returning garbage.

Passkey ceremonies cannot run in CI. Integration tests approve challenges through `approveForTest`
(`apps/leash/src/lib/test-approval.ts`): a plain function with **no route**, which throws unless
`NODE_ENV === "test"`. `next dev` and `next start` force `NODE_ENV` to `development` / `production`,
so it cannot be reached in a running service. The real ceremony needs a manual check with Touch ID.

## 90-second demo script

**Before the demo:** `pnpm demo:reset --prefill-jobs`. In Chrome, log in to the shop and the job
board as `demo@example.com`, and connect both to Leash (the "Agent permissions (Leash)" link — on the shop's Account page, in the job
board's top navigation — or approve one blocked action). Keep the Leash dashboard open in a second window. The agent is an AI
browser agent (for example Claude in Chrome) driving that same Chrome profile.

1. **(0:00) The premise.** "You can't tell bots from people any more, and I *want* my agent to shop
   for me. So the site stops guessing. It assumes everything might be my agent — and I decide how
   far it can go."
2. **(0:10) Small action, no prompt.** Tell the agent: *"Buy the coffee beans on localhost:3001."*
   It clicks Buy now → Place order and gets an order confirmation. The dashboard shows
   **Auto-allowed (unverified) — Coffee beans — $50**, and usage reads "$50 of $500 this month".
3. **(0:30) Big action, human needed.** Tell the agent: *"Now buy the wireless headphones."* The
   shop shows "This purchase needs human verification. Reason: Exceeds per-transaction limit
   ($100)". The agent can open the Leash page but cannot get past it — it has no finger.
   Press **Approve with passkey**, touch Touch ID: the order completes by itself. The dashboard
   shows **Human verified — Wireless headphones — $1,500**.
4. **(0:55) A site-defined limit.** Tell the agent: *"Apply to the Frontend Engineer job on
   localhost:3002."* It is the sixth application today, so it is blocked: "Daily application limit
   reached (5 of 5 used today)". The dashboard shows **Blocked**.
5. **(1:10) The integration.** Show `apps/shop/src/leash.ts` and the `/checkout` route: one config
   object and one middleware line. No agent SDK, no agent tokens, no CAPTCHA.
6. **(1:20) Close.** "The site never asked whether I'm a bot. It asked whether a human needed to be
   there — and only I can answer that."

## Decisions

Choices made where the spec left room.

**Protocol and security**

- **An invalid or replayed proof is treated as no proof.** `/authorize` falls through to policy
  evaluation, so the caller gets `require_human` again (plus a `proof_error` string for debugging)
  and the user is simply asked to verify again. A bad proof can never allow more than no proof would.
- **Site credentials are sent as `Authorization: Bearer <secret>` plus a `Leash-Site: <id>` header.**
- **`return_url` must be on the site's registered origin**, so a proof is never delivered elsewhere.
- **First-time setup registers a passkey bound to the challenge.** The registration ceremony itself
  requires user verification, so one Touch ID both creates the Leash account and approves the
  action. The passkey row is written in the format Better Auth's plugin uses, so it also signs the
  user in to the dashboard later. Someone who already has a Leash account can use their existing
  passkey instead.
- **Dashboard sign-up uses Better Auth's passkey-first registration** (`requireSession: false`, the
  user is created after the ceremony succeeds). The anonymous plugin is not needed. Users get a
  placeholder name and email because accounts have no password or email.
- **Linking from a site's settings reuses `/authorize`** with the reserved `__link__` action instead
  of adding an endpoint. It always returns `require_human`, records no event, and finishes without a
  proof (the site gets `leash_linked=1`).
- **Denying needs no passkey.** It can only ever stop an action.
- **Every Leash WebAuthn ceremony uses a single-use server nonce** in addition to the binding to the
  challenge id and params hash, so an assertion can be neither replayed nor moved to another action.
- **Extra schema beyond the spec:** `challenges` has `approved_at` / `approved_by` (the proof's
  expiry is counted from approval, and the proof can be re-minted identically while the verify page
  polls); `signing_keys` holds the proof key; `ceremonies` holds the WebAuthn nonces.
- **Blocked pages are reached by a 303 redirect** carrying only `action`, `reason` and
  `challenge_id`. The link to Leash is rebuilt on the server from the challenge id, so a crafted
  URL cannot point the "Verify with Leash" button somewhere else.
- **The route Leash returns to is a GET guarded by `proofRequired`.** It only acts with a proof that
  verifies for exactly this user, action and params, so a bare link to it does nothing.
- **Site secrets are stored as SHA-256** — they are high-entropy random strings, so a slow hash adds nothing.
- **The test-mode approval path is a function, not an endpoint**, guarded by `NODE_ENV === "test"`.

**Policy**

- **Limits are inclusive**: a $100 purchase passes a $100 per-transaction limit.
- **Period boundaries use server-local time** ("today" starts at local midnight, "this month" on the 1st).
- **Fail-safe policy rules beyond the spec:** a constraint added to a manifest after the user linked
  makes that action require a human until the user reviews it (same as a new action); a missing
  `ceiling` equals the `default`; a missing or non-numeric param blocks the action.
- **Human-verified actions do not count against the automatic budget.** Counters are computed from
  `auto_allowed` events only, as the spec says.

**Project**

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
- **shadcn/ui-style components are hand-written.** The Leash UI uses the shadcn layout
  (`src/components/ui`, theme tokens, `cva`), but the shadcn CLI could not be run in the build
  environment, so the components were written by hand rather than generated.
- **`pnpm demo:reset --prefill-jobs` assumes the seeded demo user** (`u_demo`) on the job board.
- **TypeScript is pinned to 5.x** for compatibility with the Next.js toolchain.
