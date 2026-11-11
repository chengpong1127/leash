# @leash/node

Express middleware that puts a site's sensitive actions on a leash: actions inside the limits the
user has set pass silently, anything beyond them needs a fresh passkey (Touch ID) approval from the
account owner on Leash.

There is no agent token and no agent-side SDK. Every logged-in request without a human proof is
treated as "this user's agent". The site needs **no database changes**.

> ## ⚠️ Trust rule: params come from the server
>
> Everything `getParams` returns — the amount, the item, the address — **must come from your
> server-side state** (the price in your database, the cart total you computed, the record you
> loaded). **Never pass a number or id the client sent as-is.**
>
> Leash evaluates the user's limits against these params and binds the human's approval to their
> hash. If `amount` is read from the request body, an agent can post `amount=1` for a $1,500 item
> and the limit means nothing.

## Integration

```ts
import { createLeash } from "@leash/node";

const leash = createLeash({
  siteId: process.env.LEASH_SITE_ID!,
  secret: process.env.LEASH_SITE_SECRET!,          // server-side only
  leashUrl: process.env.LEASH_URL!,
  getUserId: (req) => req.user?.id,                // your existing login session
  blockedPath: "/verification-required",           // your page that explains the block
  actions: {
    purchase: {
      label: "Purchase items",
      mode: "auto",                                // "auto" | "human"
      constraints: {
        amount:  { type: "max", param: "amount", label: "Per-transaction limit ($)", default: 100, ceiling: 5000 },
        monthly: { type: "sum_per_period", param: "amount", period: "month", label: "Monthly limit ($)", default: 500, ceiling: 20000 },
      },
    },
    change_address: { label: "Change shipping address", mode: "human" },
  },
});

const purchase = (req) => ({
  amount: req.order.total,                         // server-side value
  summary: `${req.order.itemName} — $${req.order.total}`,
});
const resume = (req) => `/checkout/resume?order=${req.order.id}`;

app.post("/checkout", requireLogin, loadOrder,
  leash.protect("purchase", purchase, { returnTo: resume }), checkoutHandler);

// Leash sends the human back here with ?leash_proof=… — the original action completes by itself.
app.get("/checkout/resume", requireLogin, loadOrder,
  leash.protect("purchase", purchase, { returnTo: resume, proofRequired: true }), checkoutHandler);

app.get("/account/leash", requireLogin, leash.settingsHandler({ returnTo: "/account" }));
```

## `createLeash(config)`

Validates the config and pushes the manifest (`actions`) to Leash.

- Throws at startup on invalid config, e.g. `default > ceiling`, an unknown constraint type, or a
  missing credential — a misconfigured site fails when it boots, not at checkout.
- Missing values fail safe: no `mode` → `"human"`, no `default` → `0`, no `ceiling` → the default.
- The manifest push is retried until Leash accepts it (`leash.ready` resolves then). Until it does,
  Leash only knows the previous manifest and treats unknown actions as requiring a human.

| Option | |
|---|---|
| `siteId`, `secret`, `leashUrl` | Credentials and location of the Leash service. Sent as `Authorization: Bearer <secret>` + `Leash-Site: <siteId>`. |
| `getUserId(req)` | The site's own id for the logged-in user, or nothing when not logged in. |
| `actions` | The protected actions and what users may configure (see below). |
| `blockedPath` | A page on your site shown when a browser request is blocked (see below). |
| `timeoutMs` | How long to wait for Leash before failing closed. Default 5000. |
| `pushManifest: false` | Skip the startup push (tests). |

### Actions and constraints

- `mode: "auto"` — allowed without a human while every constraint passes. `mode: "human"` — always needs a human.
- `userConfigurable: false` — the user cannot change the mode or limits.
- Constraints: `max` (one param must not exceed the limit), `sum_per_period` (sum of a param per
  `day`/`month`), `count_per_period` (number of actions per `day`/`month`).
- `default` is the limit until the user picks their own; `ceiling` is the highest they may set.
  A trailing unit in the label — `"Monthly limit ($)"` — is used to format values.

## `leash.protect(action, getParams, options?)`

`getParams(req)` returns the params (see the trust rule) plus an optional `summary`, the
human-readable line shown on the approval page. Then, per request:

1. **Nobody logged in** → `next()`. Your own auth handles it; Leash is not called.
2. **Proof** — an optional proof is read from the `Leash-Proof` header, a `leash_proof` body field
   or a `leash_proof` query parameter. It is verified locally against Leash's JWKS (signature,
   audience, expiry, and that it is bound to this user, action and params). An invalid proof is dropped.
3. **`POST /api/v1/authorize`** is called with the user id, action, params, summary, proof and return URL.
4. **`allow`** → `req.leash = { verified }` and `next()`. `verified` is `true` when a human approved
   this exact action, `false` when it was within the user's agent limits.
5. **`require_human`** →
   - JSON requests get `403 { error: "human_verification_required", reason, challenge_id, verify_url }`.
   - Browser requests are redirected (303) to `blockedPath?action=…&reason=…&challenge_id=…`.
     Render the reason there and link to `leash.verifyUrl(challenge_id)`. Without a `blockedPath`
     the SDK shows a plain built-in page.
6. **Leash unreachable, slow, erroring or answering nonsense** → **fail closed** with `503`.
   The handler never runs. There is no "allow on error" mode.

### `options.returnTo`

The path Leash sends the human back to after they approve or deny, with `leash_proof=<jwt>` or
`leash_denied=1` appended. It must be on your site's registered origin. That route should run
`protect` again for the same action with the same params, so the original action completes
without the user redoing anything. Handle `leash_denied` before `protect` to show a "declined" page.

### `options.proofRequired`

Use it on the route Leash returns to, especially when that route is a `GET`: the request only
proceeds with a proof that verifies for exactly this user, action and params — otherwise `400`
and nothing is done. A bare link to the resume URL can therefore never perform the action.

Proofs are single use: Leash consumes the proof when it allows the action, so replaying the same
URL leads back to the blocked page.

## `leash.settingsHandler({ returnTo })`

A route handler that sends the logged-in user to Leash to connect their account or manage their
agent permissions, before they are ever blocked. It returns to `returnTo` with `leash_linked=1`
after linking. It fails closed (`503`) like `protect`.

## `leash.verifyUrl(challengeId)`

The Leash page where a human approves the challenge. Always build the link from the challenge id
on the server; never trust a full URL from the query string.
