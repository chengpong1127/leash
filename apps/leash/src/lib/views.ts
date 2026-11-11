/** Read-only data loaders for the verify page, the dashboard and the settings page. */
import {
  type HistoryEntry,
  LINK_ACTION,
  type Manifest,
  type Policy,
  effectivePolicy,
  formatValue,
  parseLabel,
  periodStart,
  periodUsage,
} from "@leash/shared";
import { and, desc, eq, gte } from "drizzle-orm";
import { type Db, schema } from "../db";
import { currentStatus, findLink, getChallenge } from "./challenges";
import type { DashboardData, EventItem, PendingItem, PermissionLine, SiteItem, SiteSettings, UsageItem, VerifyView } from "./view-types";

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const PERIOD_WORD = { day: "today", month: "this month" } as const;

/** Human label for an action; unknown actions fall back to their name. */
export function actionLabel(manifest: Manifest, action: string): string {
  if (action === LINK_ACTION) return "Connect account";
  return manifest.actions[action]?.label ?? action;
}

/** What an agent may currently do for each action, in plain language. `policy` null → the site's defaults. */
export function permissionLines(manifest: Manifest, policy: Policy | null): PermissionLine[] {
  const effective = effectivePolicy(manifest, policy);
  return Object.entries(manifest.actions).map(([action, def]) => {
    const eff = effective[action]!;
    if (eff.mode === "human") return { action, label: def.label, mode: "human", text: "Always asks you" };
    const limits = Object.entries(def.constraints).map(([key, c]) => {
      const { name, unit } = parseLabel(c.label);
      return `${lowerFirst(name)} ${formatValue(eff.limits[key] ?? 0, unit)}`;
    });
    return {
      action,
      label: def.label,
      mode: "auto",
      text: limits.length ? `Allowed automatically within: ${limits.join(", ")}` : "Allowed automatically",
    };
  });
}

export function getVerifyView(db: Db, challengeId: string, sessionUserId: string | null): VerifyView | null {
  const ch = getChallenge(db, challengeId);
  if (!ch) return null;
  const site = db.select().from(schema.sites).where(eq(schema.sites.id, ch.siteId)).get();
  if (!site) return null;
  const link = findLink(db, ch.siteId, ch.siteUserId);
  return {
    id: ch.id,
    status: currentStatus(ch),
    siteId: site.id,
    siteName: site.name,
    siteOrigin: site.origin,
    action: ch.action,
    actionLabel: actionLabel(site.manifest, ch.action),
    isLink: ch.action === LINK_ACTION,
    summary: ch.summary,
    reason: ch.reason,
    returnUrl: ch.returnUrl,
    expiresAt: ch.expiresAt.getTime(),
    linked: Boolean(link),
    hasSession: sessionUserId !== null,
    sessionOwnsLink: Boolean(link && sessionUserId && link.userId === sessionUserId),
    defaults: permissionLines(site.manifest, null),
  };
}

/** Usage of every period constraint for one link: "$50 of $500 this month". */
function usageFor(db: Db, link: typeof schema.links.$inferSelect, manifest: Manifest, now: Date): UsageItem[] {
  const rows = db
    .select({ action: schema.events.action, params: schema.events.params, at: schema.events.createdAt })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.siteId, link.siteId),
        eq(schema.events.siteUserId, link.siteUserId),
        eq(schema.events.outcome, "auto_allowed"),
        gte(schema.events.createdAt, periodStart("month", now)),
      ),
    )
    .all();
  const effective = effectivePolicy(manifest, link.policy, link.paused);
  const usage: UsageItem[] = [];
  for (const [action, def] of Object.entries(manifest.actions)) {
    const history: HistoryEntry[] = rows.filter((r) => r.action === action);
    for (const [constraint, c] of Object.entries(def.constraints)) {
      if (c.type === "max") continue;
      const { name, unit } = parseLabel(c.label);
      const used = periodUsage(c, history, now);
      const limit = effective[action]?.limits[constraint] ?? 0;
      usage.push({
        action,
        actionLabel: def.label,
        constraint,
        label: name,
        used,
        limit,
        text: `${formatValue(used, unit)} of ${formatValue(limit, unit)} ${PERIOD_WORD[c.period]}`,
      });
    }
  }
  return usage;
}

export function getDashboard(db: Db, userId: string, now = new Date()): DashboardData {
  const links = db.select().from(schema.links).where(eq(schema.links.userId, userId)).orderBy(schema.links.createdAt).all();
  const pending: PendingItem[] = [];
  const events: EventItem[] = [];
  const sites: SiteItem[] = [];

  for (const link of links) {
    const site = db.select().from(schema.sites).where(eq(schema.sites.id, link.siteId)).get();
    if (!site) continue;

    for (const ch of db
      .select()
      .from(schema.challenges)
      .where(and(eq(schema.challenges.siteId, link.siteId), eq(schema.challenges.siteUserId, link.siteUserId), eq(schema.challenges.status, "pending")))
      .all()) {
      if (ch.action === LINK_ACTION || currentStatus(ch, now) !== "pending") continue;
      pending.push({
        id: ch.id,
        siteId: site.id,
        siteName: site.name,
        action: ch.action,
        actionLabel: actionLabel(site.manifest, ch.action),
        summary: ch.summary,
        reason: ch.reason,
        createdAt: ch.createdAt.getTime(),
        expiresAt: ch.expiresAt.getTime(),
      });
    }

    for (const ev of db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.siteId, link.siteId), eq(schema.events.siteUserId, link.siteUserId)))
      .orderBy(desc(schema.events.createdAt))
      .limit(50)
      .all()) {
      events.push({
        id: ev.id,
        siteId: site.id,
        siteName: site.name,
        action: ev.action,
        actionLabel: actionLabel(site.manifest, ev.action),
        summary: ev.summary,
        outcome: ev.outcome,
        reason: ev.reason,
        createdAt: ev.createdAt.getTime(),
      });
    }

    sites.push({
      linkId: link.id,
      siteId: site.id,
      name: site.name,
      origin: site.origin,
      paused: link.paused,
      usage: usageFor(db, link, site.manifest, now),
    });
  }

  pending.sort((a, b) => b.createdAt - a.createdAt);
  events.sort((a, b) => b.createdAt - a.createdAt);
  return { pending, events: events.slice(0, 50), sites };
}

export function getSiteSettings(db: Db, userId: string, siteId: string): SiteSettings | null {
  const link = db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.userId, userId), eq(schema.links.siteId, siteId)))
    .get();
  if (!link) return null;
  const site = db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).get();
  if (!site) return null;

  // Configurable actions (or limits) added to the manifest after linking: "human" until the user saves them.
  const needsReview = Object.entries(site.manifest.actions)
    .filter(([name, def]) => {
      if (!def.userConfigurable) return false;
      const stored = link.policy.actions?.[name];
      return !stored || Object.keys(def.constraints).some((key) => typeof stored.constraints?.[key] !== "number");
    })
    .map(([name]) => name);

  return {
    linkId: link.id,
    siteId: site.id,
    siteName: site.name,
    siteOrigin: site.origin,
    paused: link.paused,
    manifest: site.manifest,
    policy: link.policy,
    needsReview,
  };
}
