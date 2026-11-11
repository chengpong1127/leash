import { getDb } from "@/db";
import { type IdParams, statusResponse } from "@/lib/challenge-api";
import { denyChallenge } from "@/lib/challenges";
import { json, requireSameOrigin, respond } from "@/lib/http";

/** Deny a challenge. No passkey needed: denying can only ever stop an action. */
export const POST = (req: Request, { params }: IdParams) =>
  respond(async () => {
    requireSameOrigin(req);
    const db = getDb();
    return json(await statusResponse(db, denyChallenge(db, (await params).id)));
  });
