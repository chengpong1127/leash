import type { Db } from "../db";
import { type Challenge, approveChallenge } from "./challenges";

/**
 * Approve a challenge WITHOUT a passkey ceremony — for integration tests only, because
 * WebAuthn cannot run in CI.
 *
 * It is a plain function with no route, and it refuses to run unless NODE_ENV is exactly
 * "test". `next dev` and `next build`/`next start` force NODE_ENV to "development" and
 * "production", so there is no way to reach it in a running Leash service.
 */
export function approveForTest(db: Db, challengeId: string, userId: string, now = new Date()): Challenge {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("approveForTest is only available when NODE_ENV === 'test'");
  }
  return approveChallenge(db, challengeId, userId, now);
}
