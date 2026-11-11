import { z } from "zod";
import { getDb } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { APPROVE_PURPOSE, type IdParams, approveBinding, requireChallenge, requirePending } from "@/lib/challenge-api";
import { findLink } from "@/lib/challenges";
import { HttpError, json, parseBody, requireSameOrigin, respond } from "@/lib/http";
import type { CeremonyOptionsResponse } from "@/lib/view-types";
import { beginAssertion, beginRegistration } from "@/lib/webauthn";

const body = z.object({ mode: z.enum(["assert", "register"]) });

/** Start the passkey ceremony for approving this challenge. */
export const POST = (req: Request, { params }: IdParams) =>
  respond(async () => {
    requireSameOrigin(req);
    const db = getDb();
    const { mode } = await parseBody(req, body);
    const ch = requireChallenge(db, (await params).id);
    requirePending(ch);
    const link = findLink(db, ch.siteId, ch.siteUserId);
    const ceremony = { purpose: APPROVE_PURPOSE, binding: approveBinding(ch) };

    let result: CeremonyOptionsResponse;
    if (mode === "register") {
      if (link) throw new HttpError(409, "already_linked", "This account is already connected to Leash. Approve with your existing passkey.");
      result = await beginRegistration(db, { ...ceremony, label: "Leash account" });
    } else {
      // Linked: only the owner's passkeys. Otherwise the session is just a hint for which passkey to offer.
      const userId = link?.userId ?? (await getSessionUser(req.headers))?.id;
      result = await beginAssertion(db, { ...ceremony, userId });
    }
    return json(result);
  });
