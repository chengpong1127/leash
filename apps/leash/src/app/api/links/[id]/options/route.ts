import { z } from "zod";
import { getDb } from "@/db";
import type { IdParams } from "@/lib/challenge-api";
import { json, parseBody, requireSameOrigin, respond } from "@/lib/http";
import { policyBinding, requireOwnedLink, unpauseBinding } from "@/lib/links";
import { beginAssertion } from "@/lib/webauthn";

const body = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("policy"), policy: z.object({ actions: z.record(z.string(), z.unknown()) }) }),
  z.object({ purpose: z.literal("unpause") }),
]);

/** Start the passkey ceremony for saving settings or un-pausing — both loosen what an agent may do. */
export const POST = (req: Request, { params }: IdParams) =>
  respond(async () => {
    requireSameOrigin(req);
    const db = getDb();
    const input = await parseBody(req, body);
    const { user, link, site } = await requireOwnedLink(db, req, (await params).id);
    const binding = input.purpose === "policy" ? policyBinding(link.id, site.manifest, input.policy).binding : unpauseBinding(link.id);
    return json(await beginAssertion(db, { purpose: input.purpose, binding, userId: user.id }));
  });
