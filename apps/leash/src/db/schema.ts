import type { ChallengeStatus, EventOutcome, Manifest, Params, Policy } from "@leash/shared";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

/** A website that integrates Leash. Only a hash of its secret is stored. */
export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  origin: text("origin").notNull(),
  secretHash: text("secret_hash").notNull(),
  manifest: text("manifest", { mode: "json" }).$type<Manifest>().notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/** Connects a Leash user to their account on a site, with their agent permissions for it. */
export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    siteId: text("site_id").notNull().references(() => sites.id),
    siteUserId: text("site_user_id").notNull(),
    policy: text("policy", { mode: "json" }).$type<Policy>().notNull(),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("links_site_user_unique").on(t.siteId, t.siteUserId), index("links_user_idx").on(t.userId)],
);

/** A request for human proof for one specific action with specific params. */
export const challenges = sqliteTable(
  "challenges",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull().references(() => sites.id),
    siteUserId: text("site_user_id").notNull(),
    action: text("action").notNull(),
    params: text("params", { mode: "json" }).$type<Params>().notNull(),
    paramsHash: text("params_hash").notNull(),
    summary: text("summary").notNull(),
    reason: text("reason").notNull(),
    returnUrl: text("return_url").notNull(),
    status: text("status").$type<ChallengeStatus>().notNull().default("pending"),
    proofJti: text("proof_jti"),
    approvedAt: timestamp("approved_at"),
    approvedBy: text("approved_by"),
    createdAt: timestamp("created_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    index("challenges_site_user_idx").on(t.siteId, t.siteUserId, t.status),
    uniqueIndex("challenges_proof_jti_unique").on(t.proofJti),
  ],
);

/** Audit log of every protected action. Period counters are computed from `auto_allowed` rows. */
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id").notNull().references(() => sites.id),
    siteUserId: text("site_user_id").notNull(),
    userId: text("user_id"),
    action: text("action").notNull(),
    params: text("params", { mode: "json" }).$type<Params>().notNull(),
    summary: text("summary").notNull(),
    outcome: text("outcome").$type<EventOutcome>().notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    index("events_counter_idx").on(t.siteId, t.siteUserId, t.action, t.outcome, t.createdAt),
    index("events_user_idx").on(t.userId, t.createdAt),
  ],
);

/** Leash's EdDSA key for signing proof JWTs. Generated on first use, then reused. */
export const signingKeys = sqliteTable("signing_keys", {
  id: text("id").primaryKey(),
  privateJwk: text("private_jwk", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  publicJwk: text("public_jwk", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").notNull(),
});

/**
 * One WebAuthn ceremony started by Leash itself (not by Better Auth): approving a challenge,
 * saving settings, un-pausing. The WebAuthn challenge is SHA-256(nonce + purpose + what is
 * being authorized), so an assertion is fresh, single-use, and bound to one specific thing.
 */
export const ceremonies = sqliteTable("ceremonies", {
  id: text("id").primaryKey(),
  nonce: text("nonce").notNull(),
  kind: text("kind").$type<"assert" | "register">().notNull(),
  purpose: text("purpose").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
});

// ── Better Auth tables (users, sessions, passkeys). Property names must match Better Auth's model names. ──

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/** Written by Better Auth's passkey plugin and by Leash's own first-time setup, in the same format. */
export const passkey = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(), // base64
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(), // base64url
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at"),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkey_user_idx").on(t.userId), uniqueIndex("passkey_credential_unique").on(t.credentialID)],
);
