import { type JWK, SignJWT, importJWK, jwtVerify } from "jose";
import type { Db } from "../db";
import { leashUrl } from "./env";
import { PROOF_ALG, getSigningKey } from "./keys";

/** A proof is valid for two minutes from the moment of approval. */
export const PROOF_TTL_MS = 2 * 60 * 1000;

export interface ProofClaims {
  jti: string;
  site_user_id: string;
  action: string;
  params_hash: string;
}

interface ApprovedChallenge {
  siteId: string;
  siteUserId: string;
  action: string;
  paramsHash: string;
  proofJti: string | null;
  approvedAt: Date | null;
}

/**
 * Sign the proof JWT for an approved challenge. Deterministic for a given challenge
 * (same jti, same expiry), so the verify page can fetch it again while polling.
 */
export async function mintProof(db: Db, ch: ApprovedChallenge): Promise<string> {
  if (!ch.proofJti || !ch.approvedAt) throw new Error("Challenge is not approved");
  const key = await getSigningKey(db);
  const iat = Math.floor(ch.approvedAt.getTime() / 1000);
  return new SignJWT({ site_user_id: ch.siteUserId, action: ch.action, params_hash: ch.paramsHash })
    .setProtectedHeader({ alg: PROOF_ALG, kid: key.kid, typ: "JWT" })
    .setIssuer(leashUrl())
    .setAudience(ch.siteId)
    .setJti(ch.proofJti)
    .setIssuedAt(iat)
    .setExpirationTime(iat + PROOF_TTL_MS / 1000)
    .sign(key.privateKey);
}

/** Verify signature, issuer, audience (= site id) and expiry. Throws on any failure. */
export async function verifyProof(db: Db, token: string, siteId: string, now = new Date()): Promise<ProofClaims> {
  const key = await getSigningKey(db);
  const publicKey = await importJWK(key.publicJwk as JWK, PROOF_ALG);
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: [PROOF_ALG],
    issuer: leashUrl(),
    audience: siteId,
    currentDate: now,
  });
  const { jti, site_user_id, action, params_hash } = payload as Record<string, unknown>;
  if (typeof jti !== "string" || typeof site_user_id !== "string" || typeof action !== "string" || typeof params_hash !== "string") {
    throw new Error("Proof is missing required claims");
  }
  return { jti, site_user_id, action, params_hash };
}
