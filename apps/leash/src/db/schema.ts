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
