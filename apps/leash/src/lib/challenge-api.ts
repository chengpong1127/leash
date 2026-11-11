/** Shared pieces of the /api/challenges/[id]/* routes. */
import type { Db } from "../db";
import { type Challenge, currentStatus, getChallenge, redirectFor } from "./challenges";
import { HttpError } from "./http";
import type { ChallengeStatusResponse } from "./view-types";

export type IdParams = { params: Promise<{ id: string }> };

export function requireChallenge(db: Db, id: string): Challenge {
  const ch = getChallenge(db, id);
  if (!ch) throw new HttpError(404, "not_found", "Challenge not found");
  return ch;
}

export function requirePending(ch: Challenge): void {
  const status = currentStatus(ch);
  if (status !== "pending") throw new HttpError(409, `challenge_${status}`, `This request is already ${status}`);
}

/** What a passkey ceremony for approving this challenge is bound to: the challenge and its exact params. */
export const approveBinding = (ch: Challenge) => `approve:${ch.id}:${ch.paramsHash}`;
export const APPROVE_PURPOSE = "approve";

export async function statusResponse(db: Db, ch: Challenge): Promise<ChallengeStatusResponse> {
  return { status: currentStatus(ch), redirect_url: await redirectFor(db, ch) };
}
