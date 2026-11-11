import type { Manifest, Mode, Policy } from "./types";

/** The policy a user starts with at link time: a copy of the site's defaults. */
export function defaultPolicy(manifest: Manifest): Policy {
  const actions: Policy["actions"] = {};
  for (const [name, action] of Object.entries(manifest.actions)) {
    const constraints: Record<string, number> = {};
    for (const [key, c] of Object.entries(action.constraints)) constraints[key] = c.default;
    actions[name] = { mode: action.mode, constraints };
  }
  return { actions };
}

export interface EffectiveAction {
  mode: Mode;
  /** Effective limit per constraint: min(user value, current site ceiling). */
  limits: Record<string, number>;
  /** When mode is "human", a plain-language explanation of why. */
  humanReason?: string;
}

/**
 * What actually applies right now for each action in the manifest.
 *
 * - no link (policy null)        → site defaults
 * - userConfigurable: false      → site defaults, whatever the user stored
 * - action missing from policy   → "human" until the user reviews it
 * - constraint missing in policy → "human" until the user reviews it
 * - otherwise                    → user's mode, limits = min(user value, site ceiling)
 * - paused                       → everything "human"
 */
export function effectivePolicy(
  manifest: Manifest,
  policy: Policy | null,
  paused = false,
): Record<string, EffectiveAction> {
  const out: Record<string, EffectiveAction> = {};

  for (const [name, action] of Object.entries(manifest.actions)) {
    const siteLimits: Record<string, number> = {};
    for (const [key, c] of Object.entries(action.constraints)) siteLimits[key] = c.default;

    let eff: EffectiveAction;
    const user = policy?.actions?.[name];

    if (!policy || !action.userConfigurable) {
      eff = { mode: action.mode, limits: siteLimits };
    } else if (!user || (user.mode !== "auto" && user.mode !== "human")) {
      eff = { mode: "human", limits: siteLimits, humanReason: `"${action.label}" is a new action the account owner has not reviewed yet` };
    } else {
      const limits: Record<string, number> = {};
      let unreviewed = false;
      for (const [key, c] of Object.entries(action.constraints)) {
        const value = user.constraints?.[key];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          unreviewed = true;
          limits[key] = 0;
        } else {
          limits[key] = Math.max(0, Math.min(value, c.ceiling));
        }
      }
      eff = unreviewed
        ? { mode: "human", limits, humanReason: `"${action.label}" has a new limit the account owner has not reviewed yet` }
        : { mode: user.mode, limits };
    }

    if (paused) {
      eff = { ...eff, mode: "human", humanReason: "Agent access is paused for this site by the account owner" };
    } else if (eff.mode === "human" && !eff.humanReason) {
      eff.humanReason = `"${action.label}" always requires human verification`;
    }
    out[name] = eff;
  }
  return out;
}

/**
 * Sanitise a policy submitted from the settings form against the current manifest:
 * unknown actions/constraints dropped, values clamped to [0, ceiling], and
 * non-configurable actions reset to the site's values.
 */
export function sanitizePolicy(manifest: Manifest, submitted: unknown): Policy {
  const input = (submitted as Policy | null)?.actions ?? {};
  const base = defaultPolicy(manifest);
  for (const [name, action] of Object.entries(manifest.actions)) {
    const user = input[name];
    const target = base.actions[name]!;
    if (!action.userConfigurable || !user) continue;
    if (user.mode === "auto" || user.mode === "human") target.mode = user.mode;
    for (const [key, c] of Object.entries(action.constraints)) {
      const value = user.constraints?.[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        target.constraints[key] = Math.max(0, Math.min(value, c.ceiling));
      }
    }
  }
  return base;
}
