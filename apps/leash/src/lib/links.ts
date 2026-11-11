/** Helpers for the settings API: who owns a link, and what a passkey ceremony for it is bound to. */
import { hashParams, sanitizePolicy } from "@leash/shared";
import { eq } from "drizzle-orm";
import { type Db, schema } from "../db";
import { getSessionUser } from "./auth";
import { HttpError } from "./http";

/** The link, its site and the signed-in user — or 401 / 404. The session only identifies the user. */
export async function requireOwnedLink(db: Db, req: Request, linkId: string) {
  const user = await getSessionUser(req.headers);
  if (!user) throw new HttpError(401, "unauthorized", "Sign in to Leash first");
  const link = db.select().from(schema.links).where(eq(schema.links.id, linkId)).get();
  // Same answer for "no such link" and "someone else's link".
  if (!link || link.userId !== user.id) throw new HttpError(404, "not_found", "Site connection not found");
  const site = db.select().from(schema.sites).where(eq(schema.sites.id, link.siteId)).get();
  if (!site) throw new HttpError(404, "not_found", "Site not found");
  return { user, link, site };
}

/** Saving settings: the assertion is bound to this link and to exactly the policy being saved. */
export function policyBinding(linkId: string, manifest: Parameters<typeof sanitizePolicy>[0], submitted: unknown) {
  const policy = sanitizePolicy(manifest, submitted);
  return { policy, binding: `policy:${linkId}:${hashParams(policy)}` };
}

export const unpauseBinding = (linkId: string) => `unpause:${linkId}`;
