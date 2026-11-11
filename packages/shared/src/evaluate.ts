import { effectivePolicy } from "./policy";
import type { HistoryEntry, Manifest, NormalizedConstraint, Params, Period, Policy } from "./types";

export type Evaluation = { allowed: true } | { allowed: false; reason: string };

export interface EvaluateInput {
  manifest: Manifest;
  /** The user's stored policy, or null when no link exists (site defaults apply). */
  policy: Policy | null;
  paused?: boolean;
  action: string;
  params: Params;
  /** Past auto-allowed occurrences of this same action for this site user. */
  history: HistoryEntry[];
  now?: Date;
}

/** Start of the current day / month in server-local time. */
export function periodStart(period: Period, now: Date): Date {
  return period === "day"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getFullYear(), now.getMonth(), 1);
}

const PERIOD_WORD: Record<Period, string> = { day: "today", month: "this month" };

/** Split "Monthly limit ($)" into { name: "Monthly limit", unit: "$" }. */
export function parseLabel(label: string): { name: string; unit: string | null } {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(label);
  return m ? { name: m[1]!, unit: m[2]! } : { name: label, unit: null };
}

export function formatValue(value: number, unit: string | null): string {
  const n = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (!unit) return n;
  return unit === "$" ? `$${n}` : `${n} ${unit}`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function numericParam(params: Params, name: string): number | null {
  const v = params[name];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** How much of a period constraint is already used (0 for non-period constraints). */
export function periodUsage(c: NormalizedConstraint, history: HistoryEntry[], now: Date): number {
  if (c.type === "max") return 0;
  const start = periodStart(c.period, now).getTime();
  const inPeriod = history.filter((h) => new Date(h.at).getTime() >= start);
  if (c.type === "count_per_period") return inPeriod.length;
  return inPeriod.reduce((sum, h) => sum + (numericParam(h.params, c.param) ?? 0), 0);
}

/** Returns a plain-language reason if the constraint is violated, otherwise null. */
function checkConstraint(
  c: NormalizedConstraint,
  limit: number,
  params: Params,
  history: HistoryEntry[],
  now: Date,
): string | null {
  const { name, unit } = parseLabel(c.label);
  const shown = formatValue(limit, unit);

  switch (c.type) {
    case "max": {
      const value = numericParam(params, c.param);
      if (value === null) return `Missing or invalid "${c.param}" for ${lowerFirst(name)}`;
      return value > limit ? `Exceeds ${lowerFirst(name)} (${shown})` : null;
    }
    case "sum_per_period": {
      const value = numericParam(params, c.param);
      if (value === null) return `Missing or invalid "${c.param}" for ${lowerFirst(name)}`;
      const used = periodUsage(c, history, now);
      return used + value > limit
        ? `Would exceed ${lowerFirst(name)} (${shown}): ${formatValue(used, unit)} already used ${PERIOD_WORD[c.period]}`
        : null;
    }
    case "count_per_period": {
      const used = periodUsage(c, history, now);
      return used + 1 > limit
        ? `${name} reached (${used} of ${formatValue(limit, null)} used ${PERIOD_WORD[c.period]})`
        : null;
    }
  }
}

/**
 * Decide whether an action may proceed without human proof.
 * Pure: everything it needs is passed in. Anything unknown or malformed is blocked.
 */
export function evaluateAction(input: EvaluateInput): Evaluation {
  const { manifest, policy, paused = false, action, params, history } = input;
  const now = input.now ?? new Date();

  const def = manifest.actions[action];
  const eff = effectivePolicy(manifest, policy, paused)[action];
  if (!def || !eff) {
    return { allowed: false, reason: `Unknown action "${action}" requires human verification` };
  }
  if (eff.mode === "human") {
    return { allowed: false, reason: eff.humanReason ?? `"${def.label}" requires human verification` };
  }
  for (const [key, c] of Object.entries(def.constraints)) {
    const reason = checkConstraint(c, eff.limits[key] ?? 0, params, history, now);
    if (reason) return { allowed: false, reason };
  }
  return { allowed: true };
}
