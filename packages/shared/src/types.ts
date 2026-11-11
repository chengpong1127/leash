/** "auto": allowed without human proof while every constraint passes. "human": always needs proof. */
export type Mode = "auto" | "human";
export type Period = "day" | "month";

interface ConstraintBase {
  /** Shown in the settings form. A trailing unit in parentheses, e.g. "Monthly limit ($)", is used when formatting values. */
  label: string;
  /** Value used when the user has not chosen one. Omitted → 0 (fail safe). */
  default?: number;
  /** Highest value a user may set. Omitted → same as `default`. */
  ceiling?: number;
}

/** A single numeric param must not exceed the limit. */
export interface MaxConstraint extends ConstraintBase {
  type: "max";
  param: string;
}
/** The sum of a numeric param over auto-allowed actions in the period must not exceed the limit. */
export interface SumPerPeriodConstraint extends ConstraintBase {
  type: "sum_per_period";
  param: string;
  period: Period;
}
/** The number of auto-allowed actions in the period must not exceed the limit. */
export interface CountPerPeriodConstraint extends ConstraintBase {
  type: "count_per_period";
  period: Period;
}

/**
 * Discriminated on `type`. To add e.g. an `allowlist` constraint later: add an interface
 * here, a case in `normalizeConstraint` (manifest.ts) and a case in `checkConstraint` (evaluate.ts).
 */
export type ConstraintDef = MaxConstraint | SumPerPeriodConstraint | CountPerPeriodConstraint;
export type ConstraintType = ConstraintDef["type"];

/** What a site writes in its SDK config. */
export interface ActionDef {
  label: string;
  /** Omitted → "human" (fail safe). */
  mode?: Mode;
  /** false → the user cannot change the mode or constraints. Default true. */
  userConfigurable?: boolean;
  constraints?: Record<string, ConstraintDef>;
}
export type ActionsConfig = Record<string, ActionDef>;

/** Manifest after validation: every optional field filled in with its fail-safe value. */
export type NormalizedConstraint = ConstraintDef & { default: number; ceiling: number };
export interface NormalizedAction {
  label: string;
  mode: Mode;
  userConfigurable: boolean;
  constraints: Record<string, NormalizedConstraint>;
}
export interface Manifest {
  actions: Record<string, NormalizedAction>;
}

/** A user's per-site settings (`links.policy`): a copy of the defaults at link time, then edited. */
export interface ActionPolicy {
  mode: Mode;
  constraints: Record<string, number>;
}
export interface Policy {
  actions: Record<string, ActionPolicy>;
}

export type Params = Record<string, unknown>;

/** A past auto-allowed occurrence of an action; period counters are computed from these. */
export interface HistoryEntry {
  params: Params;
  at: Date | number;
}

export type EventOutcome = "auto_allowed" | "human_verified" | "blocked";
export type ChallengeStatus = "pending" | "approved" | "denied" | "expired" | "consumed";

/** Reserved action used by `leash.settingsHandler()` to link an account without a blocked action. */
export const LINK_ACTION = "__link__";
