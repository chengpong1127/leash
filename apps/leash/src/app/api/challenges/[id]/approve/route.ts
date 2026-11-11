import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { getDb } from "@/db";
import { APPROVE_PURPOSE, type IdParams, approveBinding, requireChallenge, requirePending, statusResponse } from "@/lib/challenge-api";
import { approveChallenge, findLink } from "@/lib/challenges";
import { HttpError, json, parseBody, requireSameOrigin, respond } from "@/lib/http";
import { finishAssertion, finishRegistration } from "@/lib/webauthn";

const body = z.object({
  mode: z.enum(["assert", "register"]),
  ceremonyId: z.string().min(1).max(100),
  response: z.record(z.string(), z.unknown()),
});

/**
 * Approve a challenge. This is the only place approval happens, and it always requires a
 * fresh, user-verified passkey ceremony bound to this challenge and its params. The session
 * cookie is not consulted: an agent driving this browser has the cookie but cannot touch the sensor.
 */
export const POST = (req: Request, { params }: IdParams) =>
  respond(async () => {
    requireSameOrigin(req);
    const db = getDb();
    const { mode, ceremonyId, response } = await parseBody(req, body);
    const ch = requireChallenge(db, (await params).id);
    requirePending(ch);
    const ceremony = { ceremonyId, purpose: APPROVE_PURPOSE, binding: approveBinding(ch) };

    let userId: string;
    if (mode === "register") {
      // First-time setup only: creating the passkey (with user verification) is itself the human proof.
      if (findLink(db, ch.siteId, ch.siteUserId)) {
        throw new HttpError(409, "already_linked", "This account is already connected to Leash. Approve with your existing passkey.");
      }
      ({ userId } = await finishRegistration(db, { ...ceremony, response: response as unknown as RegistrationResponseJSON }));
    } else {
      ({ userId } = await finishAssertion(db, { ...ceremony, response: response as unknown as AuthenticationResponseJSON }));
    }

    // Checks the passkey's user owns the link (or creates the link for a first-time user).
    const approved = approveChallenge(db, ch.id, userId);
    return json(await statusResponse(db, approved));
  });
