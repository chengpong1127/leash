import { LINK_ACTION, defaultPolicy, normalizeManifest } from "@leash/shared";
import { eq } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, schema } from "../db";
import { approveChallenge, getChallenge, redirectFor } from "../lib/challenges";
import { leashUrl } from "../lib/env";
import { HttpError } from "../lib/http";
import { getJwks } from "../lib/keys";
import { mintProof } from "../lib/proof";
import { approveForTest } from "../lib/test-approval";
import { type TestSite, addSite, authorize, jobsActions, newDb, pushManifest, shopActions } from "./helpers";

const shop: TestSite = { id: "site_shop", secret: "shop-secret", origin: "http://shop.test" };
const jobs: TestSite = { id: "site_jobs", secret: "jobs-secret", origin: "http://jobs.test" };
const USER = "usr_owner";
const now = new Date(2026, 10, 11, 15, 0, 0);
const later = (ms: number) => new Date(now.getTime() + ms);
const MIN = 60_000;

let db: Db;

beforeEach(async () => {
  db = newDb();
  addSite(db, shop, "Shop");
  addSite(db, jobs, "Jobs");
  expect((await pushManifest(db, shop, shopActions)).status).toBe(200);
  expect((await pushManifest(db, jobs, jobsActions)).status).toBe(200);
});

const events = (siteId = shop.id) => db.select().from(schema.events).where(eq(schema.events.siteId, siteId)).all();
const challenges = () => db.select().from(schema.challenges).all();

/** Block a $1,500 purchase, approve it (test mode) and return the proof JWT. */
async function approvedProof(params: Record<string, unknown> = { amount: 1500 }, siteUserId = "42") {
  const blocked = await authorize(db, shop, { params, site_user_id: siteUserId }, { now });
  expect(blocked.body.decision).toBe("require_human");
  const ch = approveForTest(db, blocked.body.challenge_id, USER, now);
  return { proof: await mintProof(db, ch), challengeId: ch.id };
}

describe("site authentication and request validation", () => {
  it("rejects a wrong secret", async () => {
    const res = await authorize(db, shop, {}, { secret: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    expect(events()).toHaveLength(0);
  });

  it("rejects an unknown site id", async () => {
    expect((await authorize(db, { ...shop, id: "site_ghost" }, {})).status).toBe(401);
  });

  it("rejects another site's secret", async () => {
    expect((await authorize(db, shop, {}, { secret: jobs.secret })).status).toBe(401);
  });

  it("rejects an invalid body", async () => {
    expect((await authorize(db, shop, "not json")).status).toBe(400);
    expect((await authorize(db, shop, { site_user_id: "" })).status).toBe(400);
    expect((await authorize(db, shop, { return_url: "not a url" })).status).toBe(400);
    expect((await authorize(db, shop, { params: "x" as never })).status).toBe(400);
    expect(events()).toHaveLength(0);
  });

  it("rejects a return_url on another origin", async () => {
    const res = await authorize(db, shop, { params: { amount: 1500 }, return_url: "http://evil.test/resume" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_return_url");
    expect(challenges()).toHaveLength(0);
  });

  it("rejects an invalid manifest and keeps the old one", async () => {
    const res = await pushManifest(db, shop, { purchase: { label: "P", constraints: { c: { type: "max", param: "amount", label: "L", default: 9, ceiling: 1 } } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_manifest");
    const site = db.select().from(schema.sites).where(eq(schema.sites.id, shop.id)).get()!;
    expect(site.manifest).toEqual(normalizeManifest(shopActions));
  });

  it("requires the site secret to push a manifest", async () => {
    expect((await pushManifest(db, shop, shopActions, "nope")).status).toBe(401);
  });
});

describe("policy decisions", () => {
  it("auto-allows an action within limits and records it", async () => {
    const res = await authorize(db, shop, { params: { amount: 50 }, summary: "Coffee beans — $50" }, { now });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ decision: "allow", verified: false });
    expect(events()).toMatchObject([{ outcome: "auto_allowed", action: "purchase", siteUserId: "42", summary: "Coffee beans — $50", params: { amount: 50 }, userId: null }]);
    expect(challenges()).toHaveLength(0);
  });

  it("blocks an action over the limit with a readable reason and a challenge", async () => {
    const res = await authorize(db, shop, { params: { amount: 1500 }, summary: "Wireless headphones — $1,500" }, { now });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      decision: "require_human",
      challenge_id: expect.stringMatching(/^ch_/),
      verify_url: `${leashUrl()}/verify/${res.body.challenge_id}`,
      reason: "Exceeds per-transaction limit ($100)",
    });
    expect(getChallenge(db, res.body.challenge_id)).toMatchObject({
      status: "pending",
      siteId: shop.id,
      siteUserId: "42",
      action: "purchase",
      params: { amount: 1500 },
      summary: "Wireless headphones — $1,500",
      reason: "Exceeds per-transaction limit ($100)",
      returnUrl: "http://shop.test/resume",
      expiresAt: later(5 * MIN),
    });
    expect(events()).toMatchObject([{ outcome: "blocked", reason: "Exceeds per-transaction limit ($100)" }]);
  });

  it("always blocks human-mode and unknown actions", async () => {
    const address = await authorize(db, shop, { action: "change_address", params: { address: "1 Main St" } });
    expect(address.body.decision).toBe("require_human");
    expect(address.body.reason).toMatch(/always requires human verification/);
    expect((await authorize(db, shop, { action: "wire_money", params: {} })).body.decision).toBe("require_human");
  });

  it("accumulates the monthly sum across auto-allowed purchases", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await authorize(db, shop, { params: { amount: 90 } }, { now: later(i * MIN) })).body.decision).toBe("allow");
    }
    const sixth = await authorize(db, shop, { params: { amount: 90 } }, { now: later(6 * MIN) });
    expect(sixth.body).toMatchObject({
      decision: "require_human",
      reason: "Would exceed monthly limit ($500): $450 already used this month",
    });
    // $50 still fits exactly; blocked attempts did not count against the budget.
    expect((await authorize(db, shop, { params: { amount: 50 } }, { now: later(7 * MIN) })).body.decision).toBe("allow");
    // Counters are per site user, and reset the next month.
    expect((await authorize(db, shop, { site_user_id: "43", params: { amount: 90 } }, { now: later(8 * MIN) })).body.decision).toBe("allow");
    expect((await authorize(db, shop, { params: { amount: 90 } }, { now: new Date(2026, 11, 1, 9) })).body.decision).toBe("allow");
  });

  it("accumulates the daily count: the sixth application is blocked", async () => {
    const apply = (n: number, at: Date) =>
      authorize(db, jobs, { action: "submit_application", params: { job_id: `job-${n}` }, return_url: `${jobs.origin}/resume` }, { now: at });
    for (let i = 1; i <= 5; i++) expect((await apply(i, later(i * MIN))).body.decision).toBe("allow");
    const sixth = await apply(6, later(6 * MIN));
    expect(sixth.body).toMatchObject({ decision: "require_human", reason: "Daily application limit reached (5 of 5 used today)" });
    expect((await apply(7, new Date(2026, 10, 12, 9))).body.decision).toBe("allow"); // next day
    expect(events(jobs.id).filter((e) => e.outcome === "auto_allowed")).toHaveLength(6);
  });

  it("human-verified actions do not consume the automatic budget", async () => {
    const { proof } = await approvedProof({ amount: 480 });
    expect((await authorize(db, shop, { params: { amount: 480 }, proof }, { now })).body).toEqual({ decision: "allow", verified: true });
    expect((await authorize(db, shop, { params: { amount: 100 } }, { now })).body.decision).toBe("allow");
  });

  it("uses the linked user's own policy and records their user id", async () => {
    const policy = defaultPolicy(normalizeManifest(shopActions));
    policy.actions.purchase!.constraints.amount = 2000;
    policy.actions.purchase!.constraints.monthly = 20000;
    db.insert(schema.links).values({ id: "ln_1", userId: USER, siteId: shop.id, siteUserId: "42", policy, createdAt: now }).run();
    expect((await authorize(db, shop, { params: { amount: 1500 } }, { now })).body).toEqual({ decision: "allow", verified: false });
    expect((await authorize(db, shop, { params: { amount: 2500 } }, { now })).body.reason).toBe("Exceeds per-transaction limit ($2,000)");
    expect(events().every((e) => e.userId === USER)).toBe(true);
  });

  it("a paused link blocks everything", async () => {
    const policy = defaultPolicy(normalizeManifest(shopActions));
    db.insert(schema.links).values({ id: "ln_1", userId: USER, siteId: shop.id, siteUserId: "42", policy, paused: true, createdAt: now }).run();
    const res = await authorize(db, shop, { params: { amount: 1 } }, { now });
    expect(res.body).toMatchObject({ decision: "require_human", reason: "Agent access is paused for this site by the account owner" });
    // Other users of the site are unaffected.
    expect((await authorize(db, shop, { site_user_id: "43", params: { amount: 1 } }, { now })).body.decision).toBe("allow");
  });

  it("the __link__ action always asks for a human and records no event", async () => {
    const res = await authorize(db, shop, { action: LINK_ACTION, params: {}, summary: "Connect" }, { now });
    expect(res.body).toMatchObject({ decision: "require_human", reason: "Connect this account to Leash" });
    expect(getChallenge(db, res.body.challenge_id)).toMatchObject({ action: LINK_ACTION, status: "pending" });
    expect(events()).toHaveLength(0);
    // Approving it creates the link and finishes the challenge without issuing a proof.
    const ch = approveForTest(db, res.body.challenge_id, USER, now);
    expect(ch).toMatchObject({ status: "consumed", proofJti: null });
    expect(await redirectFor(db, ch, now)).toBe("http://shop.test/resume?leash_linked=1");
    expect(db.select().from(schema.links).all()).toHaveLength(1);
    expect((await authorize(db, shop, { action: LINK_ACTION, params: {} }, { now })).body.reason).toBe("Manage agent permissions");
  });
});

describe("human proof", () => {
  it("accepts a proof exactly once", async () => {
    const { proof, challengeId } = await approvedProof();
    expect(getChallenge(db, challengeId)).toMatchObject({ status: "approved", approvedBy: USER });

    const first = await authorize(db, shop, { params: { amount: 1500 }, proof }, { now: later(MIN) });
    expect(first.body).toEqual({ decision: "allow", verified: true });
    expect(getChallenge(db, challengeId)!.status).toBe("consumed");
    expect(events().map((e) => e.outcome)).toEqual(["blocked", "human_verified"]);
    expect(events()[1]).toMatchObject({ userId: USER, params: { amount: 1500 } });
  });

  it("rejects a replayed proof", async () => {
    const { proof } = await approvedProof();
    expect((await authorize(db, shop, { params: { amount: 1500 }, proof }, { now })).body.decision).toBe("allow");

    const replay = await authorize(db, shop, { params: { amount: 1500 }, proof }, { now });
    expect(replay.body).toMatchObject({ decision: "require_human", proof_error: "Proof has already been used" });
    expect(events().filter((e) => e.outcome === "human_verified")).toHaveLength(1);
  });

  it("rejects a proof used with different params", async () => {
    const { proof, challengeId } = await approvedProof({ amount: 1500 });
    const res = await authorize(db, shop, { params: { amount: 4000 }, proof }, { now });
    expect(res.body).toMatchObject({ decision: "require_human", proof_error: "Proof was issued for different parameters" });
    const extra = await authorize(db, shop, { params: { amount: 1500, gift: true }, proof }, { now });
    expect(extra.body.decision).toBe("require_human");
    expect(getChallenge(db, challengeId)!.status).toBe("approved"); // not consumed by the failed attempts
  });

  it("rejects a proof used for a different action", async () => {
    const { proof } = await approvedProof({ amount: 1500 });
    const res = await authorize(db, shop, { action: "change_address", params: { amount: 1500 }, proof }, { now });
    expect(res.body).toMatchObject({ decision: "require_human", proof_error: "Proof was issued for a different action" });
  });

  it("rejects a proof used by a different user", async () => {
    const { proof } = await approvedProof({ amount: 1500 }, "42");
    const res = await authorize(db, shop, { site_user_id: "43", params: { amount: 1500 }, proof }, { now });
    expect(res.body).toMatchObject({ decision: "require_human", proof_error: "Proof was issued for a different user" });
  });

  it("rejects a proof presented by a different site", async () => {
    const { proof, challengeId } = await approvedProof({ amount: 1500 });
    // Give the jobs site the same action so only the audience differs.
    await pushManifest(db, jobs, shopActions);
    const res = await authorize(db, jobs, { params: { amount: 1500 }, proof, return_url: `${jobs.origin}/resume` }, { now });
    expect(res.body.decision).toBe("require_human");
    expect(res.body.proof_error).toBeTruthy();
    expect(getChallenge(db, challengeId)!.status).toBe("approved");
  });

  it("rejects a tampered or garbage proof", async () => {
    const { proof } = await approvedProof();
    const [h, p, s] = proof.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), params_hash: "x" })).toString("base64url");
    for (const bad of ["garbage", `${h}.${forgedPayload}.${s}`, `${h}.${p}.${"A".repeat(s!.length)}`]) {
      const res = await authorize(db, shop, { params: { amount: 1500 }, proof: bad }, { now });
      expect(res.body.decision).toBe("require_human");
      expect(res.body.proof_error).toBeTruthy();
    }
  });

  it("an invalid proof does not stop an action that is within limits anyway", async () => {
    const res = await authorize(db, shop, { params: { amount: 50 }, proof: "garbage" }, { now });
    expect(res.body).toEqual({ decision: "allow", verified: false });
  });

  it("rejects an expired proof (2 minutes after approval)", async () => {
    const { proof, challengeId } = await approvedProof();
    const res = await authorize(db, shop, { params: { amount: 1500 }, proof }, { now: later(2 * MIN + 1000) });
    expect(res.body.decision).toBe("require_human");
    expect(res.body.proof_error).toBeTruthy();
    expect(await redirectFor(db, getChallenge(db, challengeId)!, later(2 * MIN + 1000))).toBeNull();
    // Still fine just before expiry.
    const fresh = await approvedProof({ amount: 1200 });
    expect((await authorize(db, shop, { params: { amount: 1200 }, proof: fresh.proof }, { now: later(MIN) })).body.decision).toBe("allow");
  });

  it("an expired challenge cannot be approved", async () => {
    const blocked = await authorize(db, shop, { params: { amount: 1500 } }, { now });
    expect(() => approveForTest(db, blocked.body.challenge_id, USER, later(5 * MIN + 1))).toThrow(HttpError);
    try {
      approveForTest(db, blocked.body.challenge_id, USER, later(5 * MIN + 1));
    } catch (e) {
      expect(e).toMatchObject({ status: 409, code: "challenge_expired" });
    }
    expect(getChallenge(db, blocked.body.challenge_id)!.proofJti).toBeNull();
  });

  it("a challenge cannot be approved twice, or after being denied", async () => {
    const a = await authorize(db, shop, { params: { amount: 1500 } }, { now });
    approveForTest(db, a.body.challenge_id, USER, now);
    expect(() => approveForTest(db, a.body.challenge_id, USER, now)).toThrow(/already approved/);

    const { denyChallenge } = await import("../lib/challenges");
    const b = await authorize(db, shop, { params: { amount: 1500 } }, { now });
    const denied = denyChallenge(db, b.body.challenge_id, now);
    expect(denied.status).toBe("denied");
    expect(await redirectFor(db, denied, now)).toBe("http://shop.test/resume?leash_denied=1");
    expect(() => approveForTest(db, b.body.challenge_id, USER, now)).toThrow(/already denied/);
  });

  it("first-time approval creates a link with the site's default policy", async () => {
    expect(db.select().from(schema.links).all()).toHaveLength(0);
    await approvedProof();
    expect(db.select().from(schema.links).all()).toMatchObject([
      { userId: USER, siteId: shop.id, siteUserId: "42", paused: false, policy: defaultPolicy(normalizeManifest(shopActions)) },
    ]);
  });

  it("only the Leash account that owns the link can approve", async () => {
    await approvedProof(); // links site user 42 to USER
    const blocked = await authorize(db, shop, { params: { amount: 1500 } }, { now });
    expect(() => approveChallenge(db, blocked.body.challenge_id, "usr_intruder", now)).toThrow(HttpError);
    try {
      approveChallenge(db, blocked.body.challenge_id, "usr_intruder", now);
    } catch (e) {
      expect(e).toMatchObject({ status: 403, code: "wrong_account" });
    }
    expect(getChallenge(db, blocked.body.challenge_id)!.status).toBe("pending");
    expect(approveChallenge(db, blocked.body.challenge_id, USER, now).status).toBe("approved");
  });

  it("redirects back to the site with a proof that the site can verify via JWKS", async () => {
    const { challengeId } = await approvedProof({ amount: 1500 });
    const url = new URL((await redirectFor(db, getChallenge(db, challengeId)!, now))!);
    expect(url.origin + url.pathname).toBe("http://shop.test/resume");
    const proof = url.searchParams.get("leash_proof")!;

    const jwks = await getJwks(db);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" });
    expect(jwks.keys[0]).not.toHaveProperty("d"); // never the private key

    const { payload, protectedHeader } = await jwtVerify(proof, createLocalJWKSet(jwks as never), {
      algorithms: ["EdDSA"],
      issuer: leashUrl(),
      audience: shop.id,
      currentDate: now,
    });
    expect(protectedHeader).toMatchObject({ alg: "EdDSA", kid: jwks.keys[0]!.kid });
    expect(payload).toMatchObject({ aud: shop.id, site_user_id: "42", action: "purchase", jti: getChallenge(db, challengeId)!.proofJti });
    expect(payload.exp! - payload.iat!).toBe(120);
    // Re-minting (the verify page polls for it) yields the same single-use proof.
    expect(await mintProof(db, getChallenge(db, challengeId)!)).toBe(proof);
  });
});

describe("test-mode approval", () => {
  it.each(["development", "production", undefined])("refuses to run when NODE_ENV is %s", async (env) => {
    const blocked = await authorize(db, shop, { params: { amount: 1500 } }, { now });
    const original = process.env.NODE_ENV;
    try {
      if (env === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string>).NODE_ENV = env;
      expect(() => approveForTest(db, blocked.body.challenge_id, USER, now)).toThrow(/only available when NODE_ENV === 'test'/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = original;
    }
    expect(getChallenge(db, blocked.body.challenge_id)!.status).toBe("pending");
  });
});
