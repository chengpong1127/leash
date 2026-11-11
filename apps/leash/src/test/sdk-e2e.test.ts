/**
 * End to end over real HTTP: an Express site using @leash/node talks to the Leash handlers.
 * The passkey ceremony is replaced by the NODE_ENV=test approval function.
 */
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type Leash, createLeash } from "@leash/node";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Db, schema } from "../db";
import { handleAuthorize, handleManifest } from "../lib/authorize";
import { getChallenge, redirectFor } from "../lib/challenges";
import { respond } from "../lib/http";
import { getJwks } from "../lib/keys";
import { approveForTest } from "../lib/test-approval";
import { addSite, newDb, shopActions } from "./helpers";

const SECRET = "e2e-shop-secret";
const PRICES: Record<string, number> = { coffee: 50, headphones: 1500 };

let db: Db;
let leashServer: Server;
let siteServer: Server;
let site: string; // the Express site's origin
let leash: Leash;
let orders: { user: string; product: string; verified: boolean }[] = [];
const originalLeashUrl = process.env.LEASH_URL;

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

beforeAll(async () => {
  db = newDb();

  // A minimal Leash service: the same handlers the Next.js routes call.
  leashServer = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const route = `${req.method} ${req.url}`;
    const response =
      route === "PUT /api/v1/manifest"
        ? await respond(() => handleManifest(db, request))
        : route === "POST /api/v1/authorize"
          ? await respond(() => handleAuthorize(db, request))
          : route === "GET /api/v1/jwks.json"
            ? Response.json(await getJwks(db))
            : new Response("not found", { status: 404 });
    res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "text/plain" });
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  process.env.LEASH_URL = await listen(leashServer); // issuer of proofs and base of verify URLs

  // The site. Its "login" is an x-user header; prices live on the server.
  const app = express();
  siteServer = createServer(app);
  site = await listen(siteServer);
  addSite(db, { id: "site_e2e", secret: SECRET, origin: site }, "E2E Shop");

  leash = createLeash({
    siteId: "site_e2e",
    secret: SECRET,
    leashUrl: process.env.LEASH_URL,
    getUserId: (req) => req.get("x-user"),
    blockedPath: "/blocked",
    actions: shopActions,
    logger: { info() {}, warn() {} },
  });

  const productOf = (req: express.Request) => String(req.body?.product ?? req.query.product ?? "");
  const params = (req: express.Request) => ({ amount: PRICES[productOf(req)], product: productOf(req), summary: `${productOf(req)} — $${PRICES[productOf(req)]}` });
  const returnTo = (req: express.Request) => `/buy/resume?product=${productOf(req)}`;
  const buy: express.RequestHandler = (req, res) => {
    const user = req.get("x-user");
    if (!user) return void res.status(401).json({ error: "login_required" }); // the site's own auth
    orders.push({ user, product: productOf(req), verified: req.leash!.verified });
    res.json({ ok: true, verified: req.leash!.verified });
  };

  app.use(express.json(), express.urlencoded({ extended: false }));
  app.post("/buy", leash.protect("purchase", params, { returnTo }), buy);
  app.get("/buy/resume", leash.protect("purchase", params, { returnTo, proofRequired: true }), buy);
  app.get("/settings", leash.settingsHandler({ returnTo: "/account" }), (_req, res) => void res.status(401).json({ error: "login_required" }));

  await leash.ready;
});

afterAll(async () => {
  process.env.LEASH_URL = originalLeashUrl;
  await Promise.all([leashServer, siteServer].map((s) => new Promise((r) => s.close(r))));
});

beforeEach(() => {
  orders = [];
  db.delete(schema.events).run();
  db.delete(schema.challenges).run();
  db.delete(schema.links).run();
});

const buyJson = (product: string, headers: Record<string, string> = { "x-user": "42" }) =>
  fetch(`${site}/buy`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ product }) });

const buyForm = (product: string) =>
  fetch(`${site}/buy`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", "x-user": "42" },
    body: new URLSearchParams({ product }),
  });

const browse = (url: string) => fetch(url, { redirect: "manual", headers: { accept: "text/html", "x-user": "42" } });

describe("SDK ↔ Leash end to end", () => {
  it("pushed the manifest on startup", () => {
    const stored = db.select().from(schema.sites).get()!;
    expect(stored.manifest).toEqual(leash.manifest);
    expect(Object.keys(stored.manifest.actions)).toEqual(["purchase", "change_address"]);
  });

  it("lets a request within limits through", async () => {
    const res = await buyJson("coffee");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, verified: false });
    expect(orders).toEqual([{ user: "42", product: "coffee", verified: false }]);
  });

  it("answers a JSON request over the limit with 403 and a verify URL", async () => {
    const res = await buyJson("headphones");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: "human_verification_required",
      reason: "Exceeds per-transaction limit ($100)",
      challenge_id: expect.stringMatching(/^ch_/),
      verify_url: `${process.env.LEASH_URL}/verify/${body.challenge_id}`,
    });
    expect(body.verify_url).toBe(leash.verifyUrl(body.challenge_id));
    expect(orders).toEqual([]);
  });

  it("redirects a blocked HTML form post to the site's blocked page", async () => {
    const res = await buyForm("headphones");
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!, site);
    expect(location.pathname).toBe("/blocked");
    expect(Object.fromEntries(location.searchParams)).toEqual({
      action: "purchase",
      reason: "Exceeds per-transaction limit ($100)",
      challenge_id: expect.stringMatching(/^ch_/),
    });
    expect(orders).toEqual([]);
  });

  it("completes the original action exactly once after a human approves", async () => {
    const blocked = await buyForm("headphones");
    const challengeId = new URL(blocked.headers.get("location")!, site).searchParams.get("challenge_id")!;

    // The human approves on Leash (passkey replaced by test mode); Leash redirects back with the proof.
    const resumeUrl = (await redirectFor(db, approveForTest(db, challengeId, "usr_owner")))!;
    expect(resumeUrl.startsWith(`${site}/buy/resume?product=headphones&leash_proof=`)).toBe(true);

    const done = await browse(resumeUrl);
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true, verified: true });
    expect(orders).toEqual([{ user: "42", product: "headphones", verified: true }]);
    expect(getChallenge(db, challengeId)!.status).toBe("consumed");

    // Replaying the same resume URL does not order again: the proof is spent.
    const replay = await browse(resumeUrl);
    expect(replay.status).toBe(303);
    expect(new URL(replay.headers.get("location")!, site).pathname).toBe("/blocked");
    expect(orders).toHaveLength(1);
    expect(db.select().from(schema.events).all().map((e) => e.outcome)).toEqual(["blocked", "human_verified", "blocked"]);
  });

  it("also accepts the proof in the Leash-Proof header", async () => {
    const blocked = await (await buyJson("headphones")).json();
    const resumeUrl = (await redirectFor(db, approveForTest(db, blocked.challenge_id, "usr_owner")))!;
    const proof = new URL(resumeUrl).searchParams.get("leash_proof")!;
    const res = await buyJson("headphones", { "x-user": "42", "leash-proof": proof });
    expect(await res.json()).toEqual({ ok: true, verified: true });
  });

  it("does not accept a proof for a different product or user", async () => {
    const blocked = await (await buyJson("headphones")).json();
    const proof = new URL((await redirectFor(db, approveForTest(db, blocked.challenge_id, "usr_owner")))!).searchParams.get("leash_proof")!;

    // Same proof, different user → the SDK drops it locally and Leash blocks again.
    expect((await buyJson("headphones", { "x-user": "43", "leash-proof": proof })).status).toBe(403);
    // On the proof-required resume route a proof bound to other params is refused outright.
    const wrongProduct = await browse(`${site}/buy/resume?product=coffee&leash_proof=${proof}`);
    expect(wrongProduct.status).toBe(400);
    expect(orders).toEqual([]);
    expect(getChallenge(db, blocked.challenge_id)!.status).toBe("approved");
  });

  it("a bare link to the proof-required route does nothing", async () => {
    for (const url of [`${site}/buy/resume?product=coffee`, `${site}/buy/resume?product=coffee&leash_proof=garbage`]) {
      const res = await browse(url);
      expect(res.status).toBe(400);
    }
    expect(orders).toEqual([]);
    expect(db.select().from(schema.events).all()).toEqual([]);
  });

  it("stays out of the way when nobody is logged in", async () => {
    const res = await buyJson("headphones", {});
    expect(res.status).toBe(401); // the site's own handler ran
    expect(await res.json()).toEqual({ error: "login_required" });
    expect(db.select().from(schema.challenges).all()).toEqual([]);
    expect((await fetch(`${site}/settings`, { redirect: "manual" })).status).toBe(401);
  });

  it("settingsHandler sends the user to Leash to link or manage permissions", async () => {
    const res = await browse(`${site}/settings`);
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location).toMatch(new RegExp(`^${process.env.LEASH_URL}/verify/ch_`));
    const challenge = getChallenge(db, location.split("/").pop()!)!;
    expect(challenge).toMatchObject({ action: "__link__", siteUserId: "42", returnUrl: `${site}/account` });
  });
});
