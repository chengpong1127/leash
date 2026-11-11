/** Reading, approving and denying challenges. Approval is only ever called after a passkey assertion. */
import { type ChallengeStatus, LINK_ACTION, defaultPolicy } from "@leash/shared";
import { and, eq } from "drizzle-orm";
import { type Db, schema } from "../db";
import { HttpError } from "./http";
import { newId } from "./ids";
import { PROOF_TTL_MS, mintProof } from "./proof";

export type Challenge = typeof schema.challenges.$inferSelect;

export function getChallenge(db: Db, id: string): Challenge | undefined {
  return db.select().from(schema.challenges).where(eq(schema.challenges.id, id)).get();
}

/** Status as of now: pending challenges and unused proofs expire without anything writing to the row. */
export function currentStatus(ch: Challenge, now = new Date()): ChallengeStatus {
  if (ch.status === "pending" && ch.expiresAt.getTime() <= now.getTime()) return "expired";
  if (ch.status === "approved" && ch.approvedAt && ch.approvedAt.getTime() + PROOF_TTL_MS <= now.getTime()) return "expired";
  return ch.status;
}

export function findLink(db: Db, siteId: string, siteUserId: string) {
  return db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.siteId, siteId), eq(schema.links.siteUserId, siteUserId)))
    .get();
}

/**
 * Mark a challenge approved by `userId`.
 *
 * MUST only be called once `userId` has been established by a fresh, user-verified passkey
 * ceremony bound to this challenge (see webauthn.ts). A session cookie is never enough.
 *
 * - Existing link: the passkey's user must own it.
 * - No link (first time): one is created with the site's default policy. The challenge was created
 *   by the site's server with its secret, so `site_user_id` is trusted.
 */
export function approveChallenge(db: Db, challengeId: string, userId: string, now = new Date()): Challenge {
  return db.transaction(
    (tx) => {
      const ch = tx.select().from(schema.challenges).where(eq(schema.challenges.id, challengeId)).get();
      if (!ch) throw new HttpError(404, "not_found", "Challenge not found");
      const status = currentStatus(ch, now);
      if (status !== "pending") throw new HttpError(409, `challenge_${status}`, `This request is already ${status}`);

      const link = tx
        .select()
        .from(schema.links)
        .where(and(eq(schema.links.siteId, ch.siteId), eq(schema.links.siteUserId, ch.siteUserId)))
        .get();
      if (link && link.userId !== userId) {
        throw new HttpError(403, "wrong_account", "This passkey does not belong to the Leash account connected to this site account");
      }
      if (!link) {
        const site = tx.select().from(schema.sites).where(eq(schema.sites.id, ch.siteId)).get()!;
        tx.insert(schema.links)
          .values({
            id: newId("ln"),
            userId,
            siteId: ch.siteId,
            siteUserId: ch.siteUserId,
            policy: defaultPolicy(site.manifest),
            paused: false,
            createdAt: now,
          })
          .run();
      }

      // Linking has nothing to prove to the site afterwards, so it is finished immediately.
      const next: ChallengeStatus = ch.action === LINK_ACTION ? "consumed" : "approved";
      const proofJti = next === "approved" ? newId("prf") : null;
      tx.update(schema.challenges)
        .set({ status: next, proofJti, approvedAt: now, approvedBy: userId })
        .where(and(eq(schema.challenges.id, ch.id), eq(schema.challenges.status, "pending")))
        .run();
      return { ...ch, status: next, proofJti, approvedAt: now, approvedBy: userId };
    },
    { behavior: "immediate" },
  );
}

/** Denying needs no passkey: it can only ever stop an action. */
export function denyChallenge(db: Db, challengeId: string, now = new Date()): Challenge {
  const ch = getChallenge(db, challengeId);
  if (!ch) throw new HttpError(404, "not_found", "Challenge not found");
  if (currentStatus(ch, now) !== "pending") return ch;
  db.update(schema.challenges)
    .set({ status: "denied" })
    .where(and(eq(schema.challenges.id, ch.id), eq(schema.challenges.status, "pending")))
    .run();
  return getChallenge(db, challengeId)!;
}

function withParam(url: string, key: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

/** Where the browser should go next for this challenge, or null while it is still pending. */
export async function redirectFor(db: Db, ch: Challenge, now = new Date()): Promise<string | null> {
  switch (currentStatus(ch, now)) {
    case "approved":
      return withParam(ch.returnUrl, "leash_proof", await mintProof(db, ch));
    case "denied":
      return withParam(ch.returnUrl, "leash_denied", "1");
    case "consumed":
      return ch.action === LINK_ACTION ? withParam(ch.returnUrl, "leash_linked", "1") : null;
    default:
      return null;
  }
}
