import type { EventOutcome } from "@leash/shared";

/** Outcome labels. "Unverified", not "agent": a human acting within limits is not asked to verify either. */
export const OUTCOME: Record<EventOutcome, { label: string; variant: "secondary" | "success" | "destructive" }> = {
  auto_allowed: { label: "Auto-allowed (unverified)", variant: "secondary" },
  human_verified: { label: "Human verified", variant: "success" },
  blocked: { label: "Blocked", variant: "destructive" },
};

export const formatTime = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function formatRemaining(expiresAt: number, now: number): string {
  const s = Math.max(0, Math.round((expiresAt - now) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}
