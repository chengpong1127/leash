import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { loadUser, login, logout, requireLogin, safeNext } from "./auth";
import { type Order, type Product, db, getProduct, listProducts } from "./db";
import { type Raw, html } from "./html";
import { leash } from "./leash";
import { layout, money } from "./views";

const PORT = Number(new URL(process.env.SHOP_URL ?? "http://localhost:3001").port || 3001);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      product?: Product;
    }
  }
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(loadUser);

const send = (req: Request, res: Response, title: string, body: Raw) => res.send(layout(title, body, req.user));
const one = (v: unknown) => (typeof v === "string" ? v : "");

// ── Login (the shop's own; independent of Leash) ─────────────────────────────

const loginPage = (next: string, error?: string) => html`<h1>Log in</h1>
  ${error ? html`<p class="notice err" role="alert">${error}</p>` : ""}
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${next}">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <p><button class="btn" type="submit">Log in</button></p>
  </form>
  <p class="muted">Demo account: demo@example.com / demo1234</p>`;

app.get("/login", (req, res) => send(req, res, "Log in", loginPage(safeNext(req.query.next))));
app.post("/login", (req, res) => {
  const next = safeNext(req.body.next);
  if (login(res, one(req.body.email), one(req.body.password))) return res.redirect(303, next);
  res.status(401);
  send(req, res, "Log in", loginPage(next, "Wrong email or password."));
});
app.post("/logout", (req, res) => {
  logout(req, res);
  res.redirect(303, "/");
});

// ── Catalogue ────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  send(
    req,
    res,
    "Products",
    html`<h1>Products</h1>
      <p class="muted">Everyday things, delivered.</p>
      <ul class="grid">
        ${listProducts().map(
          (p) => html`<li class="card">
            <div class="emoji" aria-hidden="true">${p.emoji}</div>
            <h2><a href="/products/${p.id}">${p.name}</a></h2>
            <p class="price">${money(p.price)}</p>
          </li>`,
        )}
      </ul>`,
  );
});

app.get("/products/:id", (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return notFound(req, res);
  send(
    req,
    res,
    product.name,
    html`<p><a href="/">← All products</a></p>
      <div class="card">
        <div class="emoji" aria-hidden="true">${product.emoji}</div>
        <h1>${product.name}</h1>
        <p>${product.description}</p>
        <p class="price">${money(product.price)}</p>
        <form method="get" action="/checkout">
          <input type="hidden" name="product_id" value="${product.id}">
          <button class="btn" type="submit">Buy now</button>
        </form>
      </div>`,
  );
});

// ── Checkout: Buy now → confirm → Place order ────────────────────────────────

/** Loads the product named by the request. Everything Leash sees comes from this server-side record. */
function loadProduct(req: Request, res: Response, next: NextFunction) {
  req.product = getProduct(one(req.body?.product_id) || one(req.query.product_id));
  if (!req.product) return notFound(req, res);
  next();
}

const purchaseParams = (req: Request) => ({
  amount: req.product!.price, // server-side price, never a client-supplied number
  product_id: req.product!.id,
  summary: `${req.product!.name} — ${money(req.product!.price)}`,
});

function placeOrder(req: Request, res: Response) {
  const product = req.product!;
  const id = `ord_${randomBytes(6).toString("hex")}`;
  db.prepare(
    "INSERT INTO orders (id, user_id, product_id, product_name, amount, human_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, req.user!.id, product.id, product.name, product.price, req.leash?.verified ? 1 : 0, Date.now());
  res.redirect(303, `/orders/${id}?placed=1`);
}

app.get("/checkout", requireLogin, loadProduct, (req, res) => {
  const product = req.product!;
  send(
    req,
    res,
    "Confirm order",
    html`<h1>Confirm your order</h1>
      <div class="card">
        <h2>${product.name}</h2>
        <p>Total: <span class="price">${money(product.price)}</span></p>
        <p>Ship to: ${req.user!.address || "No address on file"}</p>
        <form method="post" action="/checkout">
          <input type="hidden" name="product_id" value="${product.id}">
          <button class="btn" type="submit">Place order</button>
          <a class="btn secondary" href="/products/${product.id}">Cancel</a>
        </form>
      </div>`,
  );
});

app.post(
  "/checkout",
  requireLogin,
  loadProduct,
  leash.protect("purchase", purchaseParams, { returnTo: (req) => `/checkout/resume?product_id=${req.product!.id}` }),
  placeOrder,
);

// Leash sends the human back here with a proof (or a denial); the original order then completes by itself.
app.get(
  "/checkout/resume",
  requireLogin,
  loadProduct,
  (req, res, next) => {
    if (!req.query.leash_denied) return next();
    send(
      req,
      res,
      "Purchase declined",
      html`<h1>Purchase declined</h1>
        <p class="notice err" role="alert">The purchase was declined by the account owner.</p>
        <p>${req.product!.name} (${money(req.product!.price)}) was not ordered. <a href="/">Back to products</a></p>`,
    );
  },
  leash.protect("purchase", purchaseParams, {
    proofRequired: true,
    returnTo: (req) => `/checkout/resume?product_id=${req.product!.id}`,
  }),
  placeOrder,
);

// ── Blocked page: shown whenever Leash asks for a human ──────────────────────

const ACTION_NOUN: Record<string, string> = { purchase: "purchase", change_address: "address change" };

app.get("/verification-required", requireLogin, (req, res) => {
  const noun = ACTION_NOUN[one(req.query.action)] ?? "action";
  res.status(403);
  send(
    req,
    res,
    "Human verification required",
    html`<h1>Human verification required</h1>
      <div class="notice warn" role="alert">
        <p><strong>This ${noun} needs human verification.</strong></p>
        <p>Reason: ${one(req.query.reason) || "Not specified"}</p>
        <p>Nothing has been done yet. The account owner must approve it in person with a passkey (Touch ID).</p>
      </div>
      <p><a class="btn" href="${leash.verifyUrl(one(req.query.challenge_id))}">Verify with Leash</a></p>
      <p class="muted">An AI agent cannot complete this step. Ask the account owner to verify.</p>`,
  );
});

// ── Orders ───────────────────────────────────────────────────────────────────

const verifiedTag = (o: Order) =>
  o.human_verified ? html`<span class="tag verified">Human verified</span>` : html`<span class="tag">Within agent limits</span>`;
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

app.get("/orders", requireLogin, (req, res) => {
  const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC").all(req.user!.id) as Order[];
  send(
    req,
    res,
    "Orders",
    html`<h1>Your orders</h1>
      ${orders.length === 0
        ? html`<p class="muted">You have no orders yet.</p>`
        : html`<table>
            <thead><tr><th>Order</th><th>Item</th><th>Total</th><th>Placed</th><th>Verification</th></tr></thead>
            <tbody>
              ${orders.map(
                (o) => html`<tr>
                  <td><a href="/orders/${o.id}">${o.id}</a></td>
                  <td>${o.product_name}</td><td>${money(o.amount)}</td><td>${when(o.created_at)}</td><td>${verifiedTag(o)}</td>
                </tr>`,
              )}
            </tbody>
          </table>`}`,
  );
});

app.get("/orders/:id", requireLogin, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id) as Order | undefined;
  if (!order) return notFound(req, res);
  send(
    req,
    res,
    "Order confirmed",
    html`${req.query.placed ? html`<p class="notice ok" role="status"><strong>Order confirmed.</strong> Thank you — your order has been placed.</p>` : ""}
      <h1>Order ${order.id}</h1>
      <div class="card">
        <h2>${order.product_name}</h2>
        <p>Total: <span class="price">${money(order.amount)}</span></p>
        <p>Placed: ${when(order.created_at)}</p>
        <p>${verifiedTag(order)}</p>
      </div>
      <p><a href="/orders">All orders</a> · <a href="/">Keep shopping</a></p>`,
  );
});

// ── Account ──────────────────────────────────────────────────────────────────

app.get("/account", requireLogin, (req, res) => {
  const user = req.user!;
  send(
    req,
    res,
    "Account",
    html`<h1>Account</h1>
      ${req.query.address_saved ? html`<p class="notice ok" role="status">Shipping address updated.</p>` : ""}
      ${req.query.leash_linked ? html`<p class="notice ok" role="status">Your account is connected to Leash.</p>` : ""}
      ${req.query.leash_denied ? html`<p class="notice err" role="alert">The request was declined by the account owner.</p>` : ""}
      <div class="card">
        <h2>Profile</h2>
        <p>${user.name} · ${user.email}</p>
      </div>
      <div class="card">
        <h2>Shipping address</h2>
        <form method="post" action="/account/address">
          <label for="address">Address</label>
          <input id="address" name="address" type="text" value="${user.address}" required maxlength="200">
          <p><button class="btn" type="submit">Save address</button></p>
        </form>
        <p class="muted">Changing the address always needs human verification.</p>
      </div>
      <div class="card">
        <h2>AI agent permissions</h2>
        <p>Decide what an AI agent may do in your account without asking you, such as spending limits.</p>
        <p><a class="btn secondary" href="/account/leash">Agent permissions (Leash)</a></p>
      </div>`,
  );
});

const addressOf = (req: Request) => (one(req.body?.address) || one(req.query.address)).trim().slice(0, 200);
const addressParams = (req: Request) => ({ address: addressOf(req), summary: `Change shipping address to "${addressOf(req)}"` });
const addressReturn = (req: Request) => `/account/address/resume?address=${encodeURIComponent(addressOf(req))}`;

function saveAddress(req: Request, res: Response) {
  db.prepare("UPDATE users SET address = ? WHERE id = ?").run(addressOf(req), req.user!.id);
  res.redirect(303, "/account?address_saved=1");
}

app.post("/account/address", requireLogin, leash.protect("change_address", addressParams, { returnTo: addressReturn }), saveAddress);
app.get(
  "/account/address/resume",
  requireLogin,
  (req, res, next) => (req.query.leash_denied ? res.redirect(303, "/account?leash_denied=1") : next()),
  leash.protect("change_address", addressParams, { proofRequired: true, returnTo: addressReturn }),
  saveAddress,
);

// Sends the user to Leash to connect this account or edit their agent permissions.
app.get("/account/leash", requireLogin, leash.settingsHandler({ returnTo: "/account" }));

// ── Misc ─────────────────────────────────────────────────────────────────────

function notFound(req: Request, res: Response) {
  res.status(404);
  send(req, res, "Not found", html`<h1>Page not found</h1><p><a href="/">Back to products</a></p>`);
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, app: "shop" });
});
app.use(notFound);

app.listen(PORT, () => console.log(`[shop] http://localhost:${PORT}`));
