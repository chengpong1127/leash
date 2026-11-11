import { getDb } from "@/db";
import { type IdParams, requireChallenge, statusResponse } from "@/lib/challenge-api";
import { json, respond } from "@/lib/http";

/**
 * Polled by the verify page every second. No session needed: the unguessable challenge id is
 * the capability, and the proof it may return is bound to one site, user, action and params.
 */
export const GET = (_req: Request, { params }: IdParams) =>
  respond(async () => {
    const db = getDb();
    return json(await statusResponse(db, requireChallenge(db, (await params).id)));
  });
