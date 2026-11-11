/** The server-to-server API that sites call through the SDK: PUT /manifest and POST /authorize. */
import { timingSafeEqual } from "node:crypto";
import { LINK_ACTION, ManifestError, type Params, evaluateAction, hashParams, normalizeManifest, periodStart } from "@leash/shared";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { type Db, schema } from "../db";
import { leashUrl } from "./env";
import { HttpError, json, parseBody } from "./http";
import { hashSecret, newId } from "./ids";
import { verifyProof } from "./proof";

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type Site = typeof schema.sites.$inferSelect;

/** `Authorization: Bearer <site secret>` plus `Leash-Site: <site id>`. Only the secret's hash is stored. */
export function authenticateSite(db: Db, req: Request): Site {
  const siteId = req.headers.get("leash-site") ?? "";
  const secret = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const site = siteId ? db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).get() : undefined;
  const given = Buffer.from(hashSecret(secret));
  const expected = Buffer.from(site?.secretHash ?? hashSecret("no-such-site"));
  if (!site || !secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, "unauthorized", "Unknown site id or wrong site secret");
  }
  return site;
}

const manifestBody = z.object({ actions: z.record(z.string(), z.unknown()) });

/** PUT /api/v1/manifest — the SDK pushes the site's actions on startup. */
export async function handleManifest(db: Db, req: Request): Promise<Response> {
  const site = authenticateSite(db, req);
  const body = await parseBody(req, manifestBody);
  let manifest;
  try {
    manifest = normalizeManifest(body.actions);
  } catch (e) {
    if (e instanceof ManifestError) throw new HttpError(400, "invalid_manifest", e.message);
    throw e;
  }
  db.update(schema.sites).set({ manifest, updatedAt: new Date() }).where(eq(schema.sites.id, site.id)).run();
  return json({ ok: true, actions: Object.keys(manifest.actions) });
}

const authorizeBody = z.object({
  site_user_id: z.string().min(1).max(200),
  action: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()).default({}),
  summary: z.string().max(500).default(""),
  proof: z.string().max(4096).nullish(),
  return_url: z.url().max(2000),
});

/** POST /api/v1/authorize — decide whether a protected action may proceed. */
export async function handleAuthorize(db: Db, req: Request, now = new Date()): Promise<Response> {
  const site = authenticateSite(db, req);
  const body = await parseBody(req, authorizeBody);
  const { site_user_id: siteUserId, action, summary } = body;
  const params = body.params as Params;

  // The human is sent back to return_url carrying the proof, so it must be the site's own page.
  if (new URL(body.return_url).origin !== site.origin) {
    throw new HttpError(400, "invalid_return_url", `return_url must be on ${site.origin}`);
  }
  let paramsHash: string;
  try {
    paramsHash = hashParams(params);
  } catch {
    throw new HttpError(400, "invalid_request", "params must be plain JSON");
  }

  // Signature / audience / expiry / claims are checked here; single use is enforced in the transaction.
  let proofJti: string | null = null;
  let proofError: string | undefined;
  if (body.proof) {
    try {
      const claims = await verifyProof(db, body.proof, site.id, now);
      if (claims.site_user_id !== siteUserId) throw new Error("Proof was issued for a different user");
      if (claims.action !== action) throw new Error("Proof was issued for a different action");
      if (claims.params_hash !== paramsHash) throw new Error("Proof was issued for different parameters");
      proofJti = claims.jti;
    } catch (e) {
      proofError = e instanceof Error ? e.message : "Invalid proof";
    }
  }

  const result = db.transaction(
    (tx) => {
      const link = tx
        .select()
        .from(schema.links)
        .where(and(eq(schema.links.siteId, site.id), eq(schema.links.siteUserId, siteUserId)))
        .get();
      const event = { siteId: site.id, siteUserId, userId: link?.userId ?? null, action, params, summary, createdAt: now };

      // 1. A valid proof: consume it. `approved → consumed` can happen exactly once.
      if (proofJti) {
        const consumed = tx
          .update(schema.challenges)
          .set({ status: "consumed" })
          .where(
            and(
              eq(schema.challenges.proofJti, proofJti),
              eq(schema.challenges.siteId, site.id),
              eq(schema.challenges.status, "approved"),
            ),
          )
          .run();
        if (consumed.changes === 1) {
          tx.insert(schema.events).values({ id: newId("ev"), ...event, outcome: "human_verified" }).run();
          return { decision: "allow" as const, verified: true };
        }
        proofError = "Proof has already been used";
      }

      // 2. No (usable) proof: evaluate the effective policy.
      //    A rejected proof is treated like no proof at all, so the caller is simply asked to verify again.
      let reason: string;
      if (action === LINK_ACTION) {
        reason = link ? "Manage agent permissions" : "Connect this account to Leash";
      } else {
        const history = tx
          .select({ params: schema.events.params, at: schema.events.createdAt })
          .from(schema.events)
          .where(
            and(
              eq(schema.events.siteId, site.id),
              eq(schema.events.siteUserId, siteUserId),
              eq(schema.events.action, action),
              eq(schema.events.outcome, "auto_allowed"),
              gte(schema.events.createdAt, periodStart("month", now)), // the longest period also covers "day"
            ),
          )
          .all();
        const evaluation = evaluateAction({
          manifest: site.manifest,
          policy: link?.policy ?? null,
          paused: link?.paused ?? false,
          action,
          params,
          history,
          now,
        });
        if (evaluation.allowed) {
          tx.insert(schema.events).values({ id: newId("ev"), ...event, outcome: "auto_allowed" }).run();
          return { decision: "allow" as const, verified: false };
        }
        reason = evaluation.reason;
        tx.insert(schema.events).values({ id: newId("ev"), ...event, outcome: "blocked", reason }).run();
      }

      // 3. Human proof needed: create a challenge bound to exactly these params.
      const challengeId = newId("ch");
      tx.insert(schema.challenges)
        .values({
          id: challengeId,
          siteId: site.id,
          siteUserId,
          action,
          params,
          paramsHash,
          summary,
          reason,
          returnUrl: body.return_url,
          status: "pending",
          createdAt: now,
          expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
        })
        .run();
      return {
        decision: "require_human" as const,
        challenge_id: challengeId,
        verify_url: `${leashUrl()}/verify/${challengeId}`,
        reason,
        ...(proofError ? { proof_error: proofError } : {}),
      };
    },
    { behavior: "immediate" },
  );

  return json(result);
}
