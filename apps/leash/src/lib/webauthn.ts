/**
 * Leash's own WebAuthn ceremonies, done with SimpleWebAuthn directly against the passkeys
 * that Better Auth stores. Better Auth's passkey plugin can sign a user in, but it cannot
 * bind an assertion to "approve exactly this challenge" — which is the whole point here.
 *
 * Every ceremony's WebAuthn challenge is SHA-256(nonce ‖ purpose ‖ binding):
 *   - nonce   — random, stored server-side, single use → the assertion is fresh, not replayable
 *   - binding — a string describing exactly what is being authorized (challenge id + params
 *               hash, or link id + policy hash). It is recomputed by the server when the
 *               assertion comes back, so an assertion for one thing cannot authorize another.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, eq, isNull } from "drizzle-orm";
import { type Db, schema } from "../db";
import { leashOrigin, rpId } from "./env";
import { HttpError } from "./http";
import { newId } from "./ids";

const CEREMONY_TTL_MS = 5 * 60 * 1000;

function ceremonyChallenge(nonce: string, purpose: string, binding: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update(`leash:v1\n${purpose}\n${nonce}\n${binding}`).digest());
}

function startCeremony(db: Db, kind: "assert" | "register", purpose: string, binding: string) {
  const id = newId("cer");
  const nonce = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.insert(schema.ceremonies)
    .values({ id, nonce, kind, purpose, createdAt: new Date(now), expiresAt: new Date(now + CEREMONY_TTL_MS) })
    .run();
  return { id, challenge: ceremonyChallenge(nonce, purpose, binding) };
}

/** Atomically use up a ceremony and return the WebAuthn challenge the client must have signed. */
function finishCeremony(db: Db, id: string, kind: "assert" | "register", purpose: string, binding: string): string {
  const row = db.select().from(schema.ceremonies).where(eq(schema.ceremonies.id, id)).get();
  if (!row || row.kind !== kind || row.purpose !== purpose || row.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(400, "ceremony_invalid", "This passkey request has expired. Please try again.");
  }
  const used = db
    .update(schema.ceremonies)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.ceremonies.id, id), isNull(schema.ceremonies.usedAt)))
    .run();
  if (used.changes !== 1) throw new HttpError(400, "ceremony_used", "This passkey request was already used.");
  return Buffer.from(ceremonyChallenge(row.nonce, purpose, binding)).toString("base64url");
}

const transportsOf = (stored: string | null) =>
  (stored ? stored.split(",").filter(Boolean) : undefined) as AuthenticatorTransport[] | undefined;

/** Start an assertion. With `userId`, only that user's passkeys are offered; otherwise any Leash passkey on the device. */
export async function beginAssertion(db: Db, input: { purpose: string; binding: string; userId?: string }) {
  const { id, challenge } = startCeremony(db, "assert", input.purpose, input.binding);
  const passkeys = input.userId
    ? db.select().from(schema.passkey).where(eq(schema.passkey.userId, input.userId)).all()
    : [];
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    challenge,
    userVerification: "required",
    allowCredentials: passkeys.length
      ? passkeys.map((p) => ({ id: p.credentialID, transports: transportsOf(p.transports) }))
      : undefined,
  });
  return { ceremonyId: id, options };
}

/**
 * Verify an assertion: fresh, user-verified (Touch ID / Face ID / PIN), made on the Leash
 * origin, and signed over the challenge for exactly this purpose and binding.
 * Returns the Leash user that owns the passkey.
 */
export async function finishAssertion(
  db: Db,
  input: { ceremonyId: string; purpose: string; binding: string; response: AuthenticationResponseJSON },
): Promise<{ userId: string }> {
  const expectedChallenge = finishCeremony(db, input.ceremonyId, "assert", input.purpose, input.binding);
  const passkey = db.select().from(schema.passkey).where(eq(schema.passkey.credentialID, String(input.response?.id))).get();
  if (!passkey) throw new HttpError(403, "unknown_passkey", "This passkey is not registered with Leash");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: leashOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: true,
      credential: {
        id: passkey.credentialID,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64")),
        counter: passkey.counter,
        transports: transportsOf(passkey.transports),
      },
    });
  } catch (e) {
    throw new HttpError(403, "passkey_failed", `Passkey verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  if (!verification.verified) throw new HttpError(403, "passkey_failed", "Passkey verification failed");

  db.update(schema.passkey).set({ counter: verification.authenticationInfo.newCounter }).where(eq(schema.passkey.id, passkey.id)).run();
  return { userId: passkey.userId };
}

/** Start creating a passkey for a brand-new Leash account, bound to `binding` like an assertion. */
export async function beginRegistration(db: Db, input: { purpose: string; binding: string; label: string }) {
  const { id, challenge } = startCeremony(db, "register", input.purpose, input.binding);
  const options = await generateRegistrationOptions({
    rpName: "Leash",
    rpID: rpId(),
    userName: input.label,
    userDisplayName: input.label,
    challenge,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return { ceremonyId: id, options };
}

/**
 * Verify a registration (user verification required) and create the Leash user and passkey,
 * in the same row format Better Auth's passkey plugin writes, so the new passkey also works
 * for ordinary Better Auth sign-in to the dashboard.
 */
export async function finishRegistration(
  db: Db,
  input: { ceremonyId: string; purpose: string; binding: string; response: RegistrationResponseJSON },
): Promise<{ userId: string }> {
  const expectedChallenge = finishCeremony(db, input.ceremonyId, "register", input.purpose, input.binding);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: leashOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: true,
    });
  } catch (e) {
    throw new HttpError(403, "passkey_failed", `Passkey registration failed: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  const info = verification.registrationInfo;
  if (!verification.verified || !info) throw new HttpError(403, "passkey_failed", "Passkey registration failed");

  const userId = newId("usr");
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(schema.user)
      .values({ id: userId, ...placeholderIdentity(userId), emailVerified: false, createdAt: now, updatedAt: now })
      .run();
    tx.insert(schema.passkey)
      .values({
        id: newId("pk"),
        name: "Passkey",
        userId,
        credentialID: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey).toString("base64"),
        counter: info.credential.counter,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        transports: input.response.response.transports?.join(",") ?? "",
        createdAt: now,
        aaguid: info.aaguid,
      })
      .run();
  });
  return { userId };
}

/** Leash accounts are passkey-only; Better Auth still wants a name and a unique email. */
export function placeholderIdentity(userId: string) {
  return { name: "Leash user", email: `${userId.toLowerCase()}@users.leash.invalid` };
}
