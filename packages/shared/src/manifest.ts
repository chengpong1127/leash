import type { Manifest, Mode, NormalizedAction, NormalizedConstraint, Period } from "./types";

export class ManifestError extends Error {
  constructor(message: string) {
    super(`Invalid Leash manifest: ${message}`);
    this.name = "ManifestError";
  }
}

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const MODES: Mode[] = ["auto", "human"];
const PERIODS: Period[] = ["day", "month"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function limit(v: unknown, where: string, field: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new ManifestError(`${where}: "${field}" must be a non-negative number`);
  }
  return v;
}

function text(v: unknown, where: string, field: string): string {
  if (typeof v !== "string" || v.trim() === "" || v.length > 200) {
    throw new ManifestError(`${where}: "${field}" must be a non-empty string`);
  }
  return v;
}

function normalizeConstraint(raw: unknown, where: string): NormalizedConstraint {
  if (!isObject(raw)) throw new ManifestError(`${where} must be an object`);
  const label = text(raw.label, where, "label");
  // Missing default → 0; missing ceiling → the default. Both fail safe.
  const def = limit(raw.default, where, "default") ?? 0;
  const ceiling = limit(raw.ceiling, where, "ceiling") ?? def;
  if (def > ceiling) {
    throw new ManifestError(`${where}: default (${def}) must be <= ceiling (${ceiling})`);
  }
  const base = { label, default: def, ceiling };

  switch (raw.type) {
    case "max":
      return { ...base, type: "max", param: text(raw.param, where, "param") };
    case "sum_per_period":
    case "count_per_period": {
      if (!PERIODS.includes(raw.period as Period)) {
        throw new ManifestError(`${where}: "period" must be one of ${PERIODS.join(", ")}`);
      }
      const period = raw.period as Period;
      return raw.type === "sum_per_period"
        ? { ...base, type: "sum_per_period", param: text(raw.param, where, "param"), period }
        : { ...base, type: "count_per_period", period };
    }
    default:
      throw new ManifestError(`${where}: unknown constraint type ${JSON.stringify(raw.type)}`);
  }
}

/**
 * Validate an actions map — `{ [actionName]: ActionDef }` — from the SDK or the network and fill in fail-safe
 * values: missing `mode` → "human", missing `default` → 0. Throws ManifestError.
 */
export function normalizeManifest(rawActions: unknown): Manifest {
  if (!isObject(rawActions)) throw new ManifestError("actions must be an object");

  const actions: Record<string, NormalizedAction> = {};
  for (const [name, raw] of Object.entries(rawActions)) {
    const where = `action "${name}"`;
    if (!NAME.test(name)) {
      throw new ManifestError(`${where}: names must match ${NAME} (names starting with "_" are reserved)`);
    }
    if (!isObject(raw)) throw new ManifestError(`${where} must be an object`);
    if (raw.mode !== undefined && !MODES.includes(raw.mode as Mode)) {
      throw new ManifestError(`${where}: "mode" must be "auto" or "human"`);
    }
    if (raw.userConfigurable !== undefined && typeof raw.userConfigurable !== "boolean") {
      throw new ManifestError(`${where}: "userConfigurable" must be a boolean`);
    }
    if (raw.constraints !== undefined && !isObject(raw.constraints)) {
      throw new ManifestError(`${where}: "constraints" must be an object`);
    }
    const constraints: Record<string, NormalizedConstraint> = {};
    for (const [key, c] of Object.entries(raw.constraints ?? {})) {
      if (!NAME.test(key)) throw new ManifestError(`${where}: invalid constraint name "${key}"`);
      constraints[key] = normalizeConstraint(c, `${where} constraint "${key}"`);
    }
    actions[name] = {
      label: text(raw.label, where, "label"),
      mode: (raw.mode as Mode | undefined) ?? "human",
      userConfigurable: raw.userConfigurable !== false,
      constraints,
    };
  }
  return { actions };
}
