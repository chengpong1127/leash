import { join } from "node:path";
import type { ActionsConfig } from "@leash/shared";
import { type Db, createDb, schema } from "../db";
import { handleAuthorize, handleManifest } from "../lib/authorize";
import { respond } from "../lib/http";
import { hashSecret } from "../lib/ids";

export const MIGRATIONS = join(import.meta.dirname, "../../drizzle");

export const shopActions: ActionsConfig = {
  purchase: {
    label: "Purchase items",
    mode: "auto",
    constraints: {
      amount: { type: "max", param: "amount", label: "Per-transaction limit ($)", default: 100, ceiling: 5000 },
      monthly: { type: "sum_per_period", param: "amount", period: "month", label: "Monthly limit ($)", default: 500, ceiling: 20000 },
    },
  },
  change_address: { label: "Change shipping address", mode: "human" },
};

export const jobsActions: ActionsConfig = {
  submit_application: {
    label: "Submit job application",
    mode: "auto",
    constraints: { daily: { type: "count_per_period", period: "day", label: "Daily application limit", default: 5, ceiling: 20 } },
  },
};

export interface TestSite {
  id: string;
  secret: string;
  origin: string;
}

export function newDb(): Db {
  return createDb(":memory:", MIGRATIONS);
}

export function addSite(db: Db, site: TestSite, name = site.id) {
  db.insert(schema.sites)
    .values({ id: site.id, name, origin: site.origin, secretHash: hashSecret(site.secret), manifest: { actions: {} }, updatedAt: new Date() })
    .run();
}

function request(site: TestSite, method: string, path: string, body: unknown, secret = site.secret): Request {
  return new Request(`http://leash.test${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, "leash-site": site.id },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function pushManifest(db: Db, site: TestSite, actions: unknown, secret?: string) {
  const res = await respond(() => handleManifest(db, request(site, "PUT", "/api/v1/manifest", { actions }, secret)));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

export interface AuthorizeInput {
  site_user_id?: string;
  action?: string;
  params?: Record<string, unknown>;
  summary?: string;
  proof?: string;
  return_url?: string;
}

/** POST /api/v1/authorize with sensible defaults for the shop's `purchase` action. */
export async function authorize(db: Db, site: TestSite, input: AuthorizeInput | string, opts: { now?: Date; secret?: string } = {}) {
  const body =
    typeof input === "string"
      ? input
      : { site_user_id: "42", action: "purchase", params: { amount: 50 }, summary: "Test item", return_url: `${site.origin}/resume`, ...input };
  const res = await respond(() => handleAuthorize(db, request(site, "POST", "/api/v1/authorize", body, opts.secret), opts.now));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
