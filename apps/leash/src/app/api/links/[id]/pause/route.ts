import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { IdParams } from "@/lib/challenge-api";
import { HttpError, json, parseBody, requireSameOrigin, respond } from "@/lib/http";
import { requireOwnedLink, unpauseBinding } from "@/lib/links";
import { finishAssertion } from "@/lib/webauthn";

const body = z.discriminatedUnion("paused", [
  z.object({ paused: z.literal(true) }),
  z.object({ paused: z.literal(false), ceremonyId: z.string().min(1).max(100), response: z.record(z.string(), z.unknown()) }),
]);

/**
 * Pause or un-pause agent access for a site. Pausing only tightens, so the session is enough;
 * un-pausing loosens, so it needs a fresh passkey assertion bound to this link.
 */
export const POST = (req: Request, { params }: IdParams) =>
  respond(async () => {
    requireSameOrigin(req);
    const db = getDb();
    const input = await parseBody(req, body);
    const { link } = await requireOwnedLink(db, req, (await params).id);

    if (!input.paused) {
      const { userId } = await finishAssertion(db, {
        ceremonyId: input.ceremonyId,
        purpose: "unpause",
        binding: unpauseBinding(link.id),
        response: input.response as unknown as AuthenticationResponseJSON,
      });
      if (userId !== link.userId) throw new HttpError(403, "wrong_account", "This passkey does not belong to the owner of this connection");
    }

    db.update(schema.links).set({ paused: input.paused }).where(eq(schema.links.id, link.id)).run();
    return json({ ok: true, paused: input.paused });
  });
