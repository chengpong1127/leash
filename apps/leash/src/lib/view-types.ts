/**
 * Shapes shared between the browser-facing API / data loaders (src/lib/views.ts, src/app/api)
 * and the React UI. Plain JSON only: timestamps are epoch milliseconds.
 */
import type { ChallengeStatus, EventOutcome, Manifest, Policy } from "@leash/shared";

/** One line describing what an agent may do for an action, e.g. "Allowed automatically up to: per-transaction limit $100, monthly limit $500". */
export interface PermissionLine {
  action: string;
  label: string; // the action's label, e.g. "Purchase items"
  mode: "auto" | "human";
  text: string; // plain-language description
}

/** Everything the verify page needs. `null` from the loader means "no such challenge". */
export interface VerifyView {
  id: string;
  status: ChallengeStatus; // already accounts for expiry
  siteId: string;
  siteName: string;
  siteOrigin: string;
  action: string;
  actionLabel: string;
  /** true for the special `__link__` action (connect / manage permissions, nothing to approve). */
  isLink: boolean;
  summary: string;
  reason: string;
  returnUrl: string;
  expiresAt: number;
  /** A link already exists for this site user → approval must come from that Leash account's passkey. */
  linked: boolean;
  /** A Leash session cookie is present. Only a UI hint — never authorization. */
  hasSession: boolean;
  /** The session's user owns the link (UI hint only). */
  sessionOwnsLink: boolean;
  /** The site's default agent permissions, shown to first-time users. */
  defaults: PermissionLine[];
}

// ── Browser-facing API ───────────────────────────────────────────────────────
// Errors from every endpoint: non-2xx with { error: string, message: string }.

/** GET /api/challenges/:id/status, and the response of POST …/approve and …/deny. */
export interface ChallengeStatusResponse {
  status: ChallengeStatus;
  /** Where to send the browser now (return_url with leash_proof / leash_denied / leash_linked), or null. */
  redirect_url: string | null;
}

/** POST /api/challenges/:id/options  body: { mode: "assert" | "register" }
 *  POST /api/links/:id/options       body: { purpose: "policy", policy: Policy } | { purpose: "unpause" } */
export interface CeremonyOptionsResponse {
  ceremonyId: string;
  /** Pass as `optionsJSON` to @simplewebauthn/browser startAuthentication / startRegistration. */
  options: unknown;
}

/** POST /api/challenges/:id/approve  body: { mode: "assert" | "register", ceremonyId, response } → ChallengeStatusResponse
 *  POST /api/challenges/:id/deny     body: {} → ChallengeStatusResponse
 *  POST /api/links/:id/policy        body: { ceremonyId, response, policy } → { ok: true, policy: Policy }
 *  POST /api/links/:id/pause         body: { paused: true } | { paused: false, ceremonyId, response } → { ok: true, paused: boolean } */

export interface PendingItem {
  id: string; // challenge id
  siteId: string;
  siteName: string;
  action: string;
  actionLabel: string;
  summary: string;
  reason: string;
  createdAt: number;
  expiresAt: number;
}

export interface EventItem {
  id: string;
  siteId: string;
  siteName: string;
  action: string;
  actionLabel: string;
  summary: string;
  outcome: EventOutcome;
  reason: string | null;
  createdAt: number;
}

export interface UsageItem {
  action: string;
  actionLabel: string;
  constraint: string;
  label: string; // constraint label without unit, e.g. "Monthly limit"
  used: number;
  limit: number;
  text: string; // e.g. "$50 of $500 this month", "5 of 5 today"
}

export interface SiteItem {
  linkId: string;
  siteId: string;
  name: string;
  origin: string;
  paused: boolean;
  usage: UsageItem[];
}

/** GET /api/dashboard (401 without a session). */
export interface DashboardData {
  pending: PendingItem[];
  events: EventItem[]; // newest first, at most 50
  sites: SiteItem[];
}

/** Data for the settings page of one linked site. */
export interface SiteSettings {
  linkId: string;
  siteId: string;
  siteName: string;
  siteOrigin: string;
  paused: boolean;
  manifest: Manifest;
  /** The user's stored policy. */
  policy: Policy;
  /** Actions that currently require a human only because the user has not reviewed them yet. */
  needsReview: string[];
}
