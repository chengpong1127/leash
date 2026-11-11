import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { IdParams } from "@/lib/challenge-api";
import { HttpError, json, parseBody, requireSameOrigin, respond } from "@/lib/http";
import { policyBinding, requireOwnedLink } from "@/lib/links";
import { finishAssertion } from "@/lib/webauthn";

const body = z.object({
  ceremonyId: z.string().min(1).max(100),
  response: z.record(z.string(), z.unknown()),
  policy: z.object({ actions: z.record(z.string(), z.unknown()) }),
});

/**
 * Save agent permissions for a site. Needs a fresh passkey assertion bound to this link and to
 * exactly the submitted policy — otherwise an agent using the session could raise its own limits.
 */
export const POST = (req: Request, { params }: IdParams) =>
  respond(async () => {
    requireSameOrigin(req);
    const db = getDb();
    const input = await parseBody(req, body);
    const { link, site } = await requireOwnedLink(db, req, (await params).id);
    const { policy, binding } = policyBinding(link.id, site.manifest, input.policy);

    const { userId } = await finishAssertion(db, {
      ceremonyId: input.ceremonyId,
      purpose: "policy",
      binding,
      response: input.response as unknown as AuthenticationResponseJSON,
    });
    if (userId !== link.userId) throw new HttpError(403, "wrong_account", "This passkey does not belong to the owner of this connection");

    db.update(schema.links).set({ policy }).where(eq(schema.links.id, link.id)).run();
    return json({ ok: true, policy });
  });
